// Send is the kit's panel-header glass button (sdkhub telegram-mini-app/panelHeader):
// grey glass while there is nothing to send, accent blue when there is, and while the agent works it is
// the same blue with a stop square. The arrow swaps into the square with the kit's own blur/scale swap.
import HeaderButton from './tma/components/PanelHeader/HeaderButton';
import { Tip } from './ui.jsx';

const Arrow = () => (
  <svg viewBox="-40 -40 592 592" width="22" height="22" style={{ width: 22, height: 22 }} aria-hidden>
    <path stroke="currentColor" strokeWidth="44" strokeLinecap="round" strokeLinejoin="round" d="m112 244l144-144l144 144M256 120v292" />
  </svg>
);
const Square = () => (
  <svg viewBox="-110 -110 732 732" width="22" height="22" style={{ width: 22, height: 22 }} aria-hidden>
    <path d="M392 432H120a40 40 0 0 1-40-40V120a40 40 0 0 1 40-40h272a40 40 0 0 1 40 40v272a40 40 0 0 1-40 40" />
  </svg>
);

export function SendButton({ running, canSend, onSend, onStop }) {
  const stop = running && !canSend;
  const live = canSend || stop;
  return (
    <Tip text={stop ? 'Stop (Esc)' : canSend ? (running ? 'Queue (Enter)' : 'Send (Enter)') : 'Type a message'}>
    <HeaderButton
      variant={live ? 'accent' : 'regular'}
      swap={<Square />}
      swapped={stop}
      disabled={!live}
      data-send
      aria-label={stop ? 'Stop' : 'Send'}
      onClick={stop ? onStop : onSend}
      style={{ flexShrink: 0, width: 32, minWidth: 32, height: 32, borderRadius: 16, cornerShape: 'round', ...(live && { background: '#d97757' }), transition: 'background-color 0.2s ease, color 0.2s ease', cursor: live ? 'pointer' : 'default' }}
    >
      <Arrow />
    </HeaderButton>
    </Tip>
  );
}
