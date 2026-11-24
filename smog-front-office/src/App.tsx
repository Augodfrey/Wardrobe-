import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { SessionProvider, useSession } from './state/session';
import AppShell from './pages/AppShell';
import Login, { AccountPage } from './pages/Login';
import EstimateEntry, { NewEstimate } from './pages/EstimateEntry';
import DocumentList from './pages/DocumentList';
import Companies from './pages/Companies';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Devices from './pages/Devices';
import TabletMode from './customer/TabletMode';
import { InvoiceView, RemoteSign } from './customer/RemoteSign';

function RequireAuth() {
  const { session, profile, loading } = useSession();
  if (loading) return <div className="p-8 text-center text-slate-500">Loading…</div>;
  if (!session) return <Login />;
  if (!profile) return <div className="p-8 text-center text-slate-600">Your account is not linked to a shop yet. Ask the owner to invite you.</div>;
  if (!profile.active) return <div className="p-8 text-center text-slate-600">Your account is disabled.</div>;
  return <Outlet />;
}

function OwnerOnly() {
  const { isOwner } = useSession();
  return isOwner ? <Outlet /> : <Navigate to="/estimate/new" replace />;
}

const router = createBrowserRouter([
  // Public customer pages (no login)
  { path: '/s/:token', element: <RemoteSign /> },
  { path: '/i/:token', element: <InvoiceView /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/tablet/:id', element: <TabletMode /> },
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <Navigate to="/estimate/new" replace /> },
          { path: '/estimate/new', element: <NewEstimate /> },
          { path: '/estimate/:id', element: <EstimateEntry /> },
          { path: '/documents', element: <DocumentList /> },
          { path: '/companies', element: <Companies /> },
          { path: '/devices', element: <Devices /> },
          { path: '/account', element: <AccountPage /> },
          { element: <OwnerOnly />, children: [
            { path: '/reports', element: <Reports /> },
            { path: '/settings', element: <Settings /> },
          ] },
          { path: '*', element: <Navigate to="/estimate/new" replace /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return <SessionProvider><RouterProvider router={router} /></SessionProvider>;
}
