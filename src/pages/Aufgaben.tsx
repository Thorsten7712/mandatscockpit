import { TodoBoard } from '../components/TodoBoard'
import { NotizenSection } from '../components/NotizenSection'

export default function Aufgaben() {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="mc-page-title">Aufgaben</h1>
      <TodoBoard />
      <NotizenSection />
    </div>
  )
}
