/**
 * B2-pm-editor 入口（docs/plan/06-r3-structure-edit-design.md §7）。
 * 单元在本目录实现 ProseMirror schema（schema.ts）/ 序列化（serialize.ts）/ 块编辑器（BlockEditor.tsx），
 * 并把这里的 export 指向真实实现；StructureView.tsx 只从此路径引入，不需再改。
 */
export { BlockEditor } from './BlockEditor'
