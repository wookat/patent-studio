export { useFormulaDialog } from '../dialogs'

export interface FormulaDialog {
  open(initial: string, onSubmit: (source: string) => void): void
}
