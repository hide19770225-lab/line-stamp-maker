"""Review an uploaded PNG ZIP without resampling/repainting characters or text.

Requires Python Pillow and Node. First run without --decisions to inspect the
report. Decisions are bound to the exact PNG SHA-256 and component ID; no image
names, coordinates, or deletion exceptions are built into the detector.
"""
import argparse
import base64
import hashlib
import html
import io
import json
from pathlib import Path
import subprocess
import zipfile
from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_zip', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--decisions', type=Path)
    args = parser.parse_args()
    decisions = json.loads(args.decisions.read_text()) if args.decisions else []
    sources, requests, used = {}, [], set()
    # Validate and fully decode every test PNG BEFORE producing outputs.
    with zipfile.ZipFile(args.input_zip) as archive:
        for entry in archive.infolist():
            name = Path(entry.filename).name
            if entry.is_dir() or not name.lower().endswith('.png') or entry.filename.startswith('__MACOSX/'):
                continue
            if name in ('main.png', 'tab.png'):
                continue
            if name in sources:
                raise ValueError('Duplicate PNG basename: ' + name)
            raw = archive.read(entry)
            image = Image.open(io.BytesIO(raw))
            image.load()
            if image.format != 'PNG' or 'A' not in image.getbands():
                raise ValueError('Transparent PNG required: ' + name)
            image = image.convert('RGBA')
            sha = hashlib.sha256(raw).hexdigest()
            selected = []
            for index, decision in enumerate(decisions):
                if decision['sha256'] == sha:
                    if not decision.get('reason', '').strip():
                        raise ValueError('Deletion requires a review reason')
                    selected.append(decision['id'])
                    used.add(index)
            sources[name] = (image, sha, selected)
            requests.append(dict(name=name, width=image.width, height=image.height,
                rgba=base64.b64encode(image.tobytes()).decode(), remove=selected))
    if not sources or len(used) != len(decisions):
        raise ValueError('No PNGs or stale/unmatched decisions; nothing written')
    results = json.loads(subprocess.check_output(['node', str(Path(__file__).with_name('residue-review.cjs'))],
        input=json.dumps(requests).encode()))
    out = args.output
    out.mkdir(parents=True, exist_ok=True)
    for folder in ['png', 'annotated', 'zoom']:
        (out / folder).mkdir(exist_ok=True)
    report, rows, zoom_links = [], [], []
    cell_width = max(im.width for im, _, _ in sources.values())
    cell_height = max(im.height for im, _, _ in sources.values()) + 30
    boards = {bg: Image.new('RGB', (cell_width * 2, len(results) * cell_height), 'gray') for bg in ['white', 'black', 'checker']}

    def background(size, bg):
        canvas = Image.new('RGBA', size, bg if bg != 'checker' else '#eeeeee')
        if bg == 'checker':
            draw = ImageDraw.Draw(canvas)
            for y in range(0, size[1], 10):
                for x in range(0, size[0], 10):
                    if (x // 10 + y // 10) % 2:
                        draw.rectangle((x, y, x + 9, y + 9), fill='#bbbbbb')
        return canvas

    for index, result in enumerate(sorted(results, key=lambda r: r['name'])):
        name = result['name']
        before, sha, selected = sources[name]
        after = Image.frombytes('RGBA', before.size, base64.b64decode(result.pop('rgba')))
        # Every channel outside the selected alpha pixels must be byte identical.
        original, updated = before.tobytes(), after.tobytes()
        changed = [i // 4 for i in range(3, len(original), 4) if original[i] != updated[i]]
        assert len(changed) == result['removed']
        assert all(original[i] == updated[i] for i in range(len(original)) if i % 4 != 3)
        assert all(updated[p * 4 + 3] == 0 for p in changed)
        after.save(out / 'png' / name)
        annotated = background(before.size, 'checker')
        annotated.alpha_composite(before)
        draw = ImageDraw.Draw(annotated)
        for c in result['candidates']:
            decision = next((d for d in decisions if d['sha256'] == sha and d['id'] == c['id']), None)
            if decision:
                c['decision'], c['reason'] = 'delete', decision['reason']
            color = {'delete': '#ff0000', 'keep': '#168050', 'review': '#d07000'}[c['decision']]
            x, y, w, h = (c[k] for k in ['x', 'y', 'width', 'height'])
            draw.rectangle((x - 2, y - 2, x + w + 1, y + h + 1), outline=color, width=1)
            draw.text((x, max(0, y - 12)), str(c['id']), fill=color)
            label = {'delete': '削除', 'keep': '保持', 'review': '要確認'}[c['decision']]
            rows.append(f"|{name}|{c['id']}|{x},{y} / {w}×{h}|{c['area']}|{c['alphaMin']}–{c['alphaMax']}|{label}|{c['reason']}|")
            if c.get('isolatedSliver'):
                # Crop comes from detected geometry, never a stamp-specific coordinate.
                box = (max(0, x - 12), max(0, y - 12), min(before.width, x + w + 12), min(before.height, y + h + 12))
                for bg in boards:
                    panels = []
                    for im in [before, after]:
                        canvas = background(before.size, bg)
                        canvas.alpha_composite(im)
                        panels.append(canvas.crop(box).resize(((box[2]-box[0])*8, (box[3]-box[1])*8), Image.Resampling.NEAREST))
                    zoom = Image.new('RGB', (panels[0].width * 2, panels[0].height + 20), 'gray')
                    zd = ImageDraw.Draw(zoom)
                    for side, panel in enumerate(panels):
                        zoom.paste(panel, (side * panel.width, 20))
                        zd.text((side * panel.width + 2, 2), 'Before' if side == 0 else 'After', fill='white')
                    filename = f"{Path(name).stem}-{c['id']}-{bg}.png"
                    zoom.save(out / 'zoom' / filename)
                    zoom_links.append('zoom/' + filename)
        annotated.convert('RGB').save(out / 'annotated' / name)
        for bg, board in boards.items():
            bd = ImageDraw.Draw(board)
            for side, im in enumerate([before, after]):
                canvas = background(im.size, bg)
                canvas.alpha_composite(im)
                board.paste(canvas.convert('RGB'), (side * cell_width, index * cell_height + 25))
                bd.text((side * cell_width + 5, index * cell_height + 5), name + (' Before' if side == 0 else ' After'), fill='white')
        result.update(sha256=sha, changedPixels=len(changed), nonSelectedPixelsIdentical=True)
        report.append(result)
    for bg, board in boards.items():
        board.save(out / f'comparison-{bg}.png')
    (out / 'decisions.json').write_text(json.dumps(decisions, ensure_ascii=False, indent=2))
    (out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    (out / 'report.md').write_text('# LINEスタンプ残留物レビュー\n\n'
        '添付の完成透過PNGを入力に、全画像を再書き出し。元の生成モデルや元一覧画像からの再生成ではありません。\n\n'
        '赤＝削除確認済み、緑＝保持、橙＝要確認（削除しない）。左右は修正前／修正後。\n\n'
        '削除は画像SHA-256と成分IDに結び付いた個別の目視レビュー結果だけに適用。'
        '検出器は背景由来を意味的に断定せず、色や面積だけで自動削除しません。保持理由も意味認識の保証ではありません。\n\n'
        f"{len(report)}枚、変更{sum(r['removed'] for r in report)}画素。RGB全画素不変、選択成分以外のRGBA全バイト不変。\n\n"
        '|画像|成分ID|左,上 / 幅×高さ|画素数|アルファ範囲|判定|理由|\n|---|---|---|---|---|---|---|\n' + '\n'.join(rows))
    links = ''.join(f'<h3>{html.escape(r["name"])}</h3><a href="png/{r["name"]}">透過PNG</a> <img src="annotated/{r["name"]}">' for r in report)
    (out / 'index.html').write_text('<!doctype html><meta charset="utf-8"><title>残留物レビュー</title>'
        '<style>body{font:16px sans-serif;max-width:1000px;margin:24px auto}img{max-width:100%;display:block}pre{white-space:pre-wrap}</style>'
        '<h1>残留物レビュー</h1><p>赤＝削除、緑＝保持、橙＝要確認。比較の左が修正前、右が修正後。</p>'
        '<a href="report.md">成分ごとの判定理由</a> / <a href="report.json">JSON</a>' +
        ''.join(f'<h2>{bg}</h2><img src="comparison-{bg}.png">' for bg in boards) +
        '<h2>細い孤立断片（8倍）</h2>' + ''.join(f'<img src="{link}">' for link in zoom_links) + links)
    with zipfile.ZipFile(out / f'line-stamps-{len(report)}.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for png in sorted((out / 'png').glob('*.png')):
            archive.write(png, png.name)
    print(json.dumps([dict(name=r['name'], removed=r['removed'], candidates=len(r['candidates'])) for r in report]))


if __name__ == '__main__':
    main()
