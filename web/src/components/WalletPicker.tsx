import { useWallet } from '../lib/wallet.tsx'
import { WalletModal } from './WalletModal.tsx'

/**
 * Mounts the connect dialog once, driven by the wallet context rather than by the header.
 *
 * ⚠ A component rather than putting `WalletModal` straight into `App`, because the modal must not be
 * rendered at all when it is closed — it registers an Escape listener and portals into `document.body`.
 */
export function WalletPicker() {
  const { pickerOpen, closePicker } = useWallet()
  if (!pickerOpen) return null
  return <WalletModal onClose={closePicker} />
}
