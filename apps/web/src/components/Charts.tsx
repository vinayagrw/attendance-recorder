import {
  BarChart as RBarChart,
  Bar,
  PieChart as RPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

interface BarChartProps {
  data: any[]
  dataKey: string
  nameKey: string
  title?: string
  height?: number
  color?: string
}

const COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#14b8a6', // teal
]

export function BarChart({
  data,
  dataKey,
  nameKey,
  title,
  height = 300,
  color = '#3b82f6',
}: BarChartProps) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      {title && <h3 className="mb-3 text-sm font-semibold text-slate-700">{title}</h3>}
      <ResponsiveContainer width="100%" height={height}>
        <RBarChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey={nameKey} tick={{ fontSize: 12 }} angle={-45} textAnchor="end" height={80} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '0.5rem',
            }}
            formatter={(value: any) =>
              typeof value === 'number' ? value.toFixed(2) : value
            }
          />
          <Bar dataKey={dataKey} fill={color} />
        </RBarChart>
      </ResponsiveContainer>
    </div>
  )
}

interface PieChartProps {
  data: any[]
  dataKey: string
  nameKey: string
  title?: string
  height?: number
}

export function PieChart({
  data,
  dataKey,
  nameKey,
  title,
  height = 300,
}: PieChartProps) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      {title && <h3 className="mb-3 text-sm font-semibold text-slate-700">{title}</h3>}
      <ResponsiveContainer width="100%" height={height}>
        <RPieChart>
          <Pie
            data={data}
            dataKey={dataKey}
            nameKey={nameKey}
            cx="50%"
            cy="50%"
            outerRadius={80}
            label={({ name, value }) => `${name}: ${value.toFixed(1)}`}
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: any) =>
              typeof value === 'number' ? value.toFixed(2) : value
            }
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </RPieChart>
      </ResponsiveContainer>
    </div>
  )
}

interface HorizontalBarChartProps {
  data: any[]
  dataKey: string
  nameKey: string
  title?: string
  height?: number
  color?: string
}

export function HorizontalBarChart({
  data,
  dataKey,
  nameKey,
  title,
  height = 400,
  color = '#3b82f6',
}: HorizontalBarChartProps) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      {title && <h3 className="mb-3 text-sm font-semibold text-slate-700">{title}</h3>}
      <ResponsiveContainer width="100%" height={height}>
        <RBarChart
          data={data}
          layout="vertical"
          margin={{ top: 5, right: 30, left: 150, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis type="number" tick={{ fontSize: 12 }} />
          <YAxis dataKey={nameKey} type="category" tick={{ fontSize: 12 }} width={140} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '0.5rem',
            }}
            formatter={(value: any) =>
              typeof value === 'number' ? value.toFixed(2) : value
            }
          />
          <Bar dataKey={dataKey} fill={color} />
        </RBarChart>
      </ResponsiveContainer>
    </div>
  )
}

