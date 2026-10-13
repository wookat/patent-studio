import { pdfjs } from 'react-pdf'

// react-pdf worker 一次性配置：导入即生效。
// 注意：本模块经由 pdf 预览的 lazy 链引入——pdf.js 需要 DOMMatrix（jsdom 没有），
// 任何非懒加载路径都不得 import 本模块，否则测试环境会被 pdf.js 拉崩。
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
