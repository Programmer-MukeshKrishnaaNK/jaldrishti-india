import { Wordmark } from './Wordmark'
import './Header.css'

export function Header() {
  return (
    <header className="app-header header">
      <h1 className="header-title">
        <Wordmark />
      </h1>
      <p className="header-tagline">See where rainwater goes.</p>
    </header>
  )
}
