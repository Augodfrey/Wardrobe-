import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from '../state/session';

export default function AppShell() {
  const { profile, shop, isOwner, signOut } = useSession();
  const link = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap rounded px-3 py-1.5 text-sm font-semibold ${isActive ? 'bg-white text-cobalt' : 'text-white/90 hover:bg-white/15'}`;
  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-40 bg-cobalt text-white shadow">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="flex items-baseline gap-0.5 font-black tracking-tight"><span>SMOG</span><span className="text-red-200">ZONE</span></div>
          <nav className="flex flex-1 gap-1 overflow-x-auto">
            <NavLink to="/estimate/new" className={link}>Estimate Entry</NavLink>
            <NavLink to="/documents" className={link}>Document List</NavLink>
            <NavLink to="/companies" className={link}>Companies</NavLink>
            {isOwner && <NavLink to="/reports" className={link}>Reports</NavLink>}
            {isOwner && <NavLink to="/settings" className={link}>Settings</NavLink>}
            <NavLink to="/devices" className={link}>Devices</NavLink>
          </nav>
          <div className="hidden text-right text-xs leading-tight sm:block">
            <div className="font-semibold">Logged in as {profile?.role}</div>
            <div className="text-white/70">{profile?.full_name} · {shop?.name}</div>
          </div>
          <button className="rounded border border-white/40 px-2 py-1 text-xs hover:bg-white/15" onClick={signOut}>Sign out</button>
        </div>
        <div className="h-1 bg-brandred" />
      </header>
      <main><Outlet /></main>
    </div>
  );
}
