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
import AdminProjects from './routes/admin/Projects'
import AdminSites from './routes/admin/Sites'
import AdminWorkers from './routes/admin/Workers'
import AdminAudit from './routes/admin/Audit'
import NotFound from './routes/NotFound'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRouter />} />

      {/* Worker (no Supabase Auth — custom JWT via Edge Function) */}
      <Route path="/worker">
        <Route index element={<Navigate to="/worker/login" replace />} />
        <Route path="login" element={<WorkerLogin />} />
        <Route path="register" element={<WorkerRegister />} />
        <Route path="pending" element={<WorkerPending />} />
        <Route path="punch" element={<WorkerPunch />} />
        <Route path="history" element={<WorkerHistory />} />
      </Route>

      {/* Supervisor (Supabase Auth, email + password + TOTP) */}
      <Route path="/supervisor">
        <Route index element={<Navigate to="/supervisor/login" replace />} />
        <Route path="login" element={<SupervisorLogin />} />
        <Route path="dashboard" element={<SupervisorDashboard />} />
        <Route path="approvals" element={<SupervisorApprovals />} />
      </Route>

      {/* Admin (Supabase Auth, role=admin) */}
      <Route path="/admin">
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
