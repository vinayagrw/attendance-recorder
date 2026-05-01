import { Routes, Route, Navigate } from 'react-router-dom'
import HomeRouter from './routes/HomeRouter'
import WorkerLogin from './routes/worker/Login'
import WorkerRegister from './routes/worker/Register'
import WorkerPunch from './routes/worker/Punch'
import WorkerHistory from './routes/worker/History'
import WorkerPending from './routes/worker/Pending'
import SupervisorLogin from './routes/supervisor/Login'
import SupervisorDashboard from './routes/supervisor/Dashboard'
import SupervisorApprovals from './routes/supervisor/Approvals'
import SupervisorReports from './routes/supervisor/Reports'
import SupervisorDailyReport from './routes/supervisor/DailyReport'
import SupervisorInviteWorker from './routes/supervisor/InviteWorker'
import SupervisorManualPunch from './routes/supervisor/ManualPunch'
import SupervisorEditPunch from './routes/supervisor/EditPunch'
import InstallPrompt from './components/InstallPrompt'
import AdminProjects from './routes/admin/Projects'
import AdminSites from './routes/admin/Sites'
import AdminWorkers from './routes/admin/Workers'
import AdminAudit from './routes/admin/Audit'
import NotFound from './routes/NotFound'
import ProtectedRoute from './components/ProtectedRoute'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRouter />} />

      {/* Worker (no Supabase Auth — custom JWT via Edge Function in M2) */}
      <Route path="/worker">
        <Route index element={<Navigate to="/worker/login" replace />} />
        <Route path="login" element={<WorkerLogin />} />
        <Route path="register" element={<WorkerRegister />} />
        <Route path="pending" element={<WorkerPending />} />
        <Route path="punch" element={<WorkerPunch />} />
        <Route path="history" element={<WorkerHistory />} />
      </Route>

      {/* Supervisor — login is public; rest require a logged-in supervisor */}
      <Route path="/supervisor">
        <Route index element={<Navigate to="/supervisor/login" replace />} />
        <Route path="login" element={<SupervisorLogin />} />
        <Route element={<ProtectedRoute />}>
          <Route path="dashboard" element={<SupervisorDashboard />} />
          <Route path="approvals" element={<SupervisorApprovals />} />
          <Route path="reports" element={<SupervisorReports />} />
          <Route path="daily-report" element={<SupervisorDailyReport />} />
          <Route path="invite-worker" element={<SupervisorInviteWorker />} />
          <Route path="manual-punch" element={<SupervisorManualPunch />} />
          <Route path="edit-punch/:id" element={<SupervisorEditPunch />} />
        </Route>
      </Route>

      {/* Admin — admin-only role gate */}
      <Route path="/admin" element={<ProtectedRoute requiredRole="admin" />}>
        <Route index element={<Navigate to="/admin/projects" replace />} />
        <Route path="projects" element={<AdminProjects />} />
        <Route path="sites" element={<AdminSites />} />
        <Route path="workers" element={<AdminWorkers />} />
        <Route path="audit" element={<AdminAudit />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export function AppWithChrome() {
  return (
    <>
      <App />
      <InstallPrompt />
    </>
  )
}
