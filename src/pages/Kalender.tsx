import { CalendarView } from '../components/CalendarView'

export default function Kalender() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="mc-page-title">Kalender</h1>
      <CalendarView />
    </div>
  )
}
