# Design Guidelines: Autonomous Crypto Trading Dashboard

## Design Approach

**Selected Approach**: Design System - Drawing from TradingView's data organization, Coinbase's professional trust signals, and Linear's modern efficiency.

**Justification**: This is a utility-focused, data-dense trading platform where clarity, efficiency, and trust are paramount. Users make financial decisions here, requiring consistent patterns and clear information hierarchy.

**Key Design Principles**:
- Data clarity above visual flourish
- Instant readability of critical metrics
- Professional trust signals throughout
- Efficient use of screen real estate
- Clear status indicators and alerts

## Typography System

**Font Families** (via Google Fonts CDN):
- Primary: Inter (400, 500, 600, 700) - UI elements, body text, data labels
- Monospace: JetBrains Mono (400, 500) - numerical data, prices, percentages

**Hierarchy**:
- Dashboard Title: text-2xl font-semibold
- Section Headers: text-lg font-semibold
- Card Titles: text-base font-medium
- Data Labels: text-sm font-medium
- Values/Metrics: text-lg font-semibold (monospace for numbers)
- Small Data: text-xs font-normal
- Critical Alerts: text-sm font-semibold

## Layout System

**Spacing Primitives**: Use Tailwind units of 2, 4, 6, 8 for consistent rhythm
- Tight spacing: p-2, gap-2
- Standard spacing: p-4, gap-4, m-4
- Section spacing: p-6, py-8
- Large spacing: p-8, gap-8

**Dashboard Structure**:
- Sidebar: Fixed width 280px (w-70), full height
- Main Content: flex-1 with max-width constraints per section
- Grid System: Use CSS Grid for dashboard cards (grid-cols-1 md:grid-cols-2 lg:grid-cols-3)

## Component Library

### Navigation & Layout

**Sidebar Navigation**:
- Full-height fixed sidebar with logo at top
- Navigation items with icons (Heroicons) and labels
- Active state indicators
- Settings section pinned to bottom
- Collapsible on mobile (drawer pattern)

**Top Bar**:
- Account balance prominently displayed
- Active trading mode indicator
- Auto-trading status toggle (with clear on/off states)
- Notifications icon with badge count
- User profile menu (dropdown)

### Core Dashboard Components

**Trading Mode Selector**:
- Large, segmented control with 4 options (Scalping, Intraday, Swing, Long-Term)
- Active mode prominently highlighted
- Includes timeframe indicator (5m, 15m, 1H, 1D) beneath each option

**Control Panel Card**:
- Leverage slider with numeric input (1x-100x)
- Balance allocation slider with percentage display (10%-100%)
- Concurrent trades selector (1-10)
- Large Start/Stop Auto-Trading button with status indicator
- All controls in single organized card with clear labels

**Live Trade Monitor**:
- Table layout showing active positions
- Columns: Asset, Direction (Long/Short badge), Entry Price, Current Price, PnL, SL, TP, Confidence Score
- Real-time price updates with green/red indicators
- Action buttons for manual close
- Empty state when no active trades

**Market Analysis Card**:
- Displays Groq's latest analysis
- Strongest/Weakest assets list
- Recommended trade details (if available)
- Confidence score with visual meter
- Pattern explanation in readable format
- Multi-timeframe confluence reasoning

**Performance Dashboard**:
- Today's PnL (large, prominent number)
- Win rate percentage with visual indicator
- Number of trades executed
- Best/worst performing asset
- Mini chart showing PnL over time

**Trade History Table**:
- Paginated table with filtering
- Columns: Time, Asset, Mode, Direction, Entry, Exit, PnL, Duration
- Expandable rows for full trade details
- Export functionality button

### Data Display Components

**Stat Cards**:
- 3-4 cards in row layout
- Large primary number (metric value)
- Small label above
- Trend indicator (up/down arrow with percentage)
- Subtle border treatment

**Alert/Notification Cards**:
- Email notification log
- Trade execution alerts
- SL/TP hit notifications
- Daily summary cards
- Timestamp and read/unread states

**Chart Container**:
- Dedicated space for embedded price charts (placeholder for future TradingView widget)
- Multi-timeframe toggle tabs
- Clean borders and padding

### Form Elements

**Input Fields**:
- Consistent height (h-10)
- Clear labels positioned above
- Monospace font for numerical inputs
- Inline validation states
- Suffix indicators (%, x) where applicable

**Sliders**:
- Track with clear min/max labels
- Large, accessible handle
- Current value display above handle
- Tick marks for key values

**Buttons**:
Primary Action: Large (px-6 py-3), font-semibold
Secondary Action: Medium (px-4 py-2), font-medium
Destructive: Same sizing as primary
Icon-only: Square (h-10 w-10), centered icon

**Badges/Pills**:
- Trading mode indicators: Rounded-full, px-3 py-1, text-xs
- Direction badges (Long/Short): Uppercase, font-semibold, px-2 py-1
- Status indicators: Small dot + text combination

## Icons

**Library**: Heroicons (via CDN)
- Navigation: outline style, 24px
- Inline icons: solid style, 20px
- Status indicators: solid style, 16px
- Buttons: outline style, 20px

**Key Icons**:
- Trading modes: ChartBarIcon, ClockIcon, TrendingUpIcon, CalendarIcon
- Actions: PlayIcon, StopIcon, PlusIcon, XMarkIcon
- Status: CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon
- Settings: CogIcon, BellIcon, UserCircleIcon

## Animations

**Use Sparingly**:
- Number transitions for live PnL (smooth counter animation)
- Slide transitions for sidebar on mobile
- Subtle pulse on critical alerts
- No complex scroll animations or parallax

## Responsive Behavior

**Desktop (lg+)**:
- Sidebar always visible
- 3-column grid for stat cards
- 2-column for main dashboard sections

**Tablet (md)**:
- Collapsible sidebar
- 2-column grid for cards
- Stack control panels

**Mobile (base)**:
- Bottom navigation bar
- Single column layout
- Expandable sections for complex controls
- Sticky top bar with essential info

## Images

This dashboard application uses **no hero images or marketing imagery**. All visual elements are functional:
- Logo/brand mark in sidebar header (SVG, 40x40px)
- User avatar in profile menu (circular, 32x32px)
- Asset icons for cryptocurrencies (if available from API, 24x24px)
- Empty state illustrations for "No active trades" (simple line art, centered, 200x200px max)

## Critical Design Notes

- **Trust Signals**: Professional typography, clear data hierarchy, and precise numerical formatting build credibility
- **Status Clarity**: Use distinct visual patterns for active/inactive states, profitable/losing positions, and system status
- **Error Prevention**: Confirmation modals for destructive actions, clear validation on settings changes
- **Accessibility**: All critical information available without color alone (use icons + text), keyboard navigation throughout
- **Data Density**: Embrace information-rich layouts but use whitespace strategically to prevent overwhelm
- **Real-time Updates**: Design for live data - flickering or constant movement should be minimal and purposeful