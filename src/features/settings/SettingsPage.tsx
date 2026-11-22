/**
 * The Settings page.
 */
import { PageHead } from '../../components/PageHead';
import { useStore } from '../../state/store';
import { Account } from './Account';
import { BackgroundCard } from './BackgroundCard';
import { Employees } from './Employees';
import { RoomSetup } from './RoomSetup';
import { SecurityCard } from './SecurityCard';
import { SheetCard } from './SheetCard';
import { ThemeCard } from './ThemeCard';

export function SettingsPage() {
  const { staff, backend } = useStore();
  const owner = !!staff?.owner;
  return (
    <>
      <PageHead title="Settings" sub={owner ? 'Your account, look and feel, employees, security, rooms and the Google Sheet' : 'Your account and look'} />
      <div className="set-grid">
        <Account />
        <ThemeCard />
        {owner && <BackgroundCard />}
        <SheetCard />
        {owner && <Employees />}
        {owner && <SecurityCard />}
        {owner && backend.mode === 'live' && <RoomSetup />}
        {owner && backend.mode === 'demo' && <RoomSetup />}
      </div>
    </>
  );
}
