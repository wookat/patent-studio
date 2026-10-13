# w6-spec 证据目录（2026-09-06，`devin/w6-spec`）

| 文件 | 内容 | 如何产生 |
|---|---|---|
| `ds-vs-proto--light.png` / `--dark.png` | 左：真实 `#/__ds`（vite :5173，AUTH 未起、无后端 → 右下红 toast 属预期）；右：C 原型 `components.html`；1440×900 | `shoot-ds.js` + `montage` `[实测]` |
| `ds-real--1440-{light,dark}.png` · `ds-proto--1440-{light,dark}.png` | 单张原图 | 同上 |
| `probe.json` | 两页 `getComputedStyle` 探针：根 token、body 字号、全部按钮高度集合、全部字号集合 | 同上 |
| `contrast.py` | 05 §1 全部 OKLCH 值的 WCAG 对比度实算（OKLCH → 线性 sRGB → 相对亮度） | `python3 contrast.py` |
| `shoot-ds.js` | 采集脚本（`NODE_PATH=<含 playwright-core> node shoot-ds.js`） | — |

## 并排所见：真实 `#/__ds` 现状 vs 原型 C（`probe.json` + 截图，`[实测]`）

| 项 | 真实 `#/__ds`（W5） | 原型 `components.html` | 05 冻结值 |
|---|---|---|---|
| body 字号 | 14px | 13px | **14px**（05 §0.3-1） |
| 页内出现的字号集合 | 11 12 13 14 16 20 24 | **9 10** 11 12 13 14 16 20 24 | 最小 **11**，禁 9 / 10（05 §0.3-2）；原型 9/10 处施工时提到 11 |
| 按钮高度集合 | 16 18 20 26 28 32 36（icon / 徽章混入） | 22 24 28 32 36 **40** | 5 档 **24 28 32 36 44**；原型 40 档删除（xl = 44，05 §1.7） |
| 首个按钮 | 28 高 / 12px / r4 | 28 高 / 13px / r3 | sm 28 / 13px / r4 |
| 灰阶 | `--n0..n9` 10 阶；暗色 `--background = --n9 0.250` 单层 | `--g0..g11` 12 阶；暗 app 0.175 / panel 0.215 / sunken 0.160 / elevated 0.255 四层 | 原型值（05 §1.1 §1.2） |
| 状态 | `StatusBadge` pill（12px）+ `dotOnly` 变体（只有点） | 8px 色点 + 文字，10 态；亮暗并排 | `StatusDot` 点 + 文字，无 dotOnly（05 §2.1） |
| 侧栏 / 伴随栏 | `--w-side 208` / `--w-agent 320` | 240 / 360 | 240 / 360 |
| Segmented | `--h-segmented 36` | 32（proto `--h-md`） | 32 / 44 |
| 页面覆盖 | token 色块 + 字阶 + 尺寸条 + Button 变体；**无**输入态 / 开关 / 勾选 / 热度 / 倒计时；亮暗**不**并排 | 灰阶 · 状态点 · 按钮 · 输入 / 选择 / 开关 / 勾选 …（滚动可见更多）亮暗**并排** | prep 按 05 §5.2-3 补齐 |

结论：规格总表（05 §1）与原型 token 一致（`--g*`、四层面、`--w-side 240`、`--w-agent 360`、`--h-md 32`、`--r-xl 12` 均由探针读出同值）；与原型不一致的 8 处是有意修正，全部列于 05 §0.3。真实 `#/__ds` 与规格的差距即 prep 工作量（05 §5.2）。
