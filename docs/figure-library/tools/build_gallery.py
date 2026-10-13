import json, html, os

OUT = "/home/ubuntu/ps/survey/figlib"
m = json.load(open(os.path.join(OUT, "manifest.json"), encoding="utf-8"))
figs = m["figures"]
patents = {p["id"]: p for p in m["patents"]}

ORDER = ["A0实施环境图", "A1系统架构图", "A2模块分解图", "A3分层架构图", "A4模型结构图",
         "A5设备介质产品图", "B流程图", "B3数据流图", "C1交互示意图", "C2时序泳道图",
         "D状态图", "E1数据结构图", "E2界面示意图", "F曲线数据图", "G样例对象图",
         "H视图样图", "Z未分类"]
groups = {}
for e in figs:
    groups.setdefault(e["kind"], []).append(e)

parts = ["""<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>专利附图分类图库</title><style>
body{font-family:system-ui,"Microsoft YaHei",sans-serif;margin:24px;background:#fafafa}
h1{font-size:22px} h2{font-size:17px;margin:26px 0 8px;border-bottom:2px solid #333;padding-bottom:4px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.card{background:#fff;border:1px solid #ddd;border-radius:6px;padding:8px}
.card img{width:100%;height:200px;object-fit:contain;background:#fff}
.meta{font-size:11px;color:#555;margin-top:6px;line-height:1.45}
.cap{font-size:12px;color:#111;margin-top:4px}
.nav{position:sticky;top:0;background:#fafafa;padding:8px 0;z-index:5}
.nav a{margin-right:10px;font-size:13px;color:#06c;text-decoration:none}
.count{color:#888;font-size:12px}
input#q{padding:6px 10px;width:280px;font-size:14px;border:1px solid #bbb;border-radius:6px}
</style></head><body>
<h1>专利附图分类图库 <span class="count">%d 篇专利 · %d 张附图</span></h1>
<div class="nav"><input id="q" placeholder="搜题注/专利号/标题…" oninput="filt()"> """]
parts.append("".join(f'<a href="#{k}">{k}</a>' for k in ORDER if k in groups))
parts.append("</div>")
for k in ORDER:
    if k not in groups:
        continue
    items = groups[k]
    parts.append(f'<h2 id="{k}">{k} <span class="count">{len(items)} 张</span></h2><div class="grid">')
    for e in items:
        cap = html.escape(e["caption"] or "(无题注)")
        ttl = html.escape(e["title"])
        parts.append(
            f'<div class="card" data-s="{html.escape(e["patent"]+e["caption"]+e["title"]).lower()}">'
            f'<img loading="lazy" src="{e["file"]}">'
            f'<div class="cap">{cap}</div>'
            f'<div class="meta">{e["patent"]} 图{e["fig"]} · {ttl}</div></div>')
    parts.append("</div>")
parts.append("""<script>
function filt(){const q=document.getElementById('q').value.toLowerCase();
document.querySelectorAll('.card').forEach(c=>{c.style.display=c.dataset.s.includes(q)?'':'none'});}
</script></body></html>""")

open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write("".join(parts))
print("gallery written,", len(figs), "figs")
