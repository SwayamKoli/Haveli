/**
 * Shows whichever pop-up or drawer is open.
 */
import { BookingDrawer } from '../features/bookings/BookingDrawer';
import { BookingModal } from '../features/bookings/BookingModal';
import { PaymentModal } from '../features/bookings/PaymentModal';
import { RoomDrawer } from '../features/rooms/RoomDrawer';
import { RoomModal } from '../features/rooms/RoomModal';
import { OwnerSheetPrompt } from '../features/settings/OwnerSheetPrompt';
import { useStore } from '../state/store';
import { ConfirmLogout } from './ConfirmLogout';

export function Layers() {
  const { layer } = useStore();
  if (!layer) return null;
  switch (layer.kind) {
    case 'booking': return <BookingModal />;
    case 'booking-edit': return <BookingModal editId={layer.id} />;
    case 'booking-view': return <BookingDrawer id={layer.id} />;
    case 'room-add': return <RoomModal />;
    case 'room': return <RoomDrawer no={layer.no} />;
    case 'payment': return <PaymentModal id={layer.id} />;
    case 'confirm-logout': return <ConfirmLogout />;
    case 'owner-sheet': return <OwnerSheetPrompt />;
  }
}
