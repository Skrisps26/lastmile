'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Boxes,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  CreditCard,
  Download,
  Filter,
  Gauge,
  LayoutDashboard,
  MapPin,
  Menu,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Truck,
  UserRound,
  Users,
  X,
  Zap,
} from 'lucide-react';

type Role = 'customer' | 'agent' | 'admin';
type OrderStatus = 'In transit' | 'Out for delivery' | 'Delivered' | 'Picked up';
type LiveOrder = { id: string; trackingNumber: string; route: string; status: string; date: string; amount: string; tone: string; raw?: any };

const orders: Array<{ id: string; route: string; status: OrderStatus; date: string; amount: string; tone: string }> = [
  { id: 'LM-48291', route: 'Indiranagar → Koramangala', status: 'Out for delivery', date: 'Today, 10:24 AM', amount: '₹248.00', tone: 'pink' },
  { id: 'LM-48276', route: 'Whitefield → HSR Layout', status: 'In transit', date: 'Yesterday, 4:18 PM', amount: '₹312.50', tone: 'amber' },
  { id: 'LM-48102', route: 'Jayanagar → Richmond Town', status: 'Delivered', date: '12 Jun, 2:42 PM', amount: '₹184.00', tone: 'green' },
];

const agents = [
  { name: 'Arjun Menon', initials: 'AM', zone: 'South Bengaluru', load: '4 / 6', status: 'On delivery', color: 'indigo', eta: '12 min' },
  { name: 'Priya Shah', initials: 'PS', zone: 'East Bengaluru', load: '2 / 5', status: 'Available', color: 'orange', eta: '—' },
  { name: 'Rohan Das', initials: 'RD', zone: 'Central Bengaluru', load: '5 / 5', status: 'At capacity', color: 'slate', eta: '—' },
  { name: 'Nisha Kapoor', initials: 'NK', zone: 'North Bengaluru', load: '1 / 4', status: 'Available', color: 'teal', eta: '—' },
];

function StatusPill({ status }: { status: string }) {
  const style = status.toLowerCase().replaceAll(' ', '-');
  return <span className={`status-pill status-${style}`}><span className="status-dot" />{status}</span>;
}

function Avatar({ initials, color = 'indigo', small = false }: { initials: string; color?: string; small?: boolean }) {
  return <span className={`avatar avatar-${color} ${small ? 'avatar-small' : ''}`}>{initials}</span>;
}

function Sidebar({ role, mobileOpen, setMobileOpen, onLogout }: { role: Role; mobileOpen: boolean; setMobileOpen: (open: boolean) => void; onLogout: () => void }) {
  const nav = role === 'customer'
    ? [['Overview', LayoutDashboard], ['My orders', Package], ['Addresses', MapPin], ['Billing', CreditCard]]
    : role === 'agent'
      ? [['Today', LayoutDashboard], ['My deliveries', Truck], ['Earnings', BarChart3], ['Profile', UserRound]]
      : [['Command center', LayoutDashboard], ['Orders', Package], ['Agents', Users], ['Zones & rates', Gauge]];
  return <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
    <div className="brand"><span className="brand-mark"><Zap size={17} fill="currentColor" /></span><span>lastmile<span className="brand-dot">.</span></span></div>
    <div className="workspace-switcher"><div className="eyebrow">Signed in as</div><div className="workspace-button"><span className={`workspace-icon workspace-${role}`}><ShieldCheck size={15} /></span><span>{role === 'customer' ? 'Customer portal' : role === 'agent' ? 'Agent console' : 'Admin command'}</span></div></div>
    <nav className="sidebar-nav">
      <div className="eyebrow">Menu</div>
      {nav.map(([label, Icon], index) => <a className={`nav-item ${index === 0 ? 'active' : ''}`} key={label as string} href={label === 'My orders' || label === 'Orders' || label === 'My deliveries' ? '#orders' : label === 'Agents' ? '#agents' : label === 'Zones & rates' ? '#zones' : '#overview'} onClick={() => setMobileOpen(false)}><Icon size={17} /><span>{label as string}</span>{label === 'My orders' && <span className="nav-count">3</span>}</a>)}
    </nav>
    <div className="sidebar-bottom"><button className="nav-item" onClick={() => alert('Settings are coming soon.')}><Settings2 size={17} /><span>Settings</span></button><button className="nav-item" onClick={() => alert('Help center is coming soon.')}><CircleHelp size={17} /><span>Help center</span></button><button className="nav-item logout-link" onClick={onLogout}><X size={17} /><span>Log out</span></button><div className="sidebar-profile"><Avatar initials={role === 'customer' ? 'AK' : role === 'agent' ? 'AM' : 'RS'} color="indigo" small /><div><strong>{role === 'customer' ? 'Aarav Kapoor' : role === 'agent' ? 'Arjun Menon' : 'Riya Shah'}</strong><span>{role === 'customer' ? 'Business account' : role === 'agent' ? 'Delivery partner' : 'Operations lead'}</span></div><MoreHorizontal size={16} /></div></div>
  </aside>;
}

function Topbar({ role, setMobileOpen, onLogout }: { role: Role; setMobileOpen: (open: boolean) => void; onLogout: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const name = role === 'customer' ? 'Aarav Kapoor' : role === 'agent' ? 'Arjun Menon' : 'Riya Shah';
  return <header className="topbar"><button className="mobile-menu" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><div className="topbar-search"><Search size={17} /><input placeholder={role === 'admin' ? 'Search orders, agents, tracking IDs...' : 'Search your shipments...'} /></div><div className="topbar-actions"><button className="icon-button" onClick={() => alert('You are all caught up.')}><Bell size={18} /><span className="notification-dot" /></button><div className="topbar-divider" /><div className="account-menu"><button className="topbar-user" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen}><Avatar initials={role === 'customer' ? 'AK' : role === 'agent' ? 'AM' : 'RS'} color="indigo" small /><span>{name}</span><ChevronDown size={14} /></button>{menuOpen && <div className="account-dropdown"><div className="account-dropdown-head"><Avatar initials={role === 'customer' ? 'AK' : role === 'agent' ? 'AM' : 'RS'} color="indigo" small /><div><strong>{name}</strong><span>{role === 'customer' ? 'Business account' : role === 'agent' ? 'Delivery partner' : 'Operations lead'}</span></div></div><button onClick={() => alert('Profile settings are coming soon.')}>View profile</button><button onClick={() => alert('Account settings are coming soon.')}>Account settings</button><button className="dropdown-logout" onClick={onLogout}>Log out</button></div>}</div></div></header>;
}

function MetricCard({ label, value, change, icon: Icon, accent }: { label: string; value: string; change?: string; icon: typeof Package; accent: string }) {
  return <div className="metric-card"><div className="metric-top"><span className={`metric-icon ${accent}`}><Icon size={18} /></span>{change && <span className="metric-change"><ArrowUpRight size={13} />{change}</span>}</div><div className="metric-value">{value}</div><div className="metric-label">{label}</div></div>;
}

function CustomerView({ onCreate, customerOrders }: { onCreate: () => void; customerOrders: LiveOrder[] }) {
  const [tracking, setTracking] = useState('');
  const visibleOrders = customerOrders;
  return <>
    <div className="page-heading"><div><div className="eyebrow accent-eyebrow">Monday, 17 June 2024</div><h1>Good morning, Aarav <span className="heading-wave">✦</span></h1><p>Keep an eye on your shipments and send something new.</p></div><button className="button button-primary" onClick={onCreate}><Plus size={17} /> Create shipment</button></div>
    <section className="hero-card"><div className="hero-copy"><span className="hero-kicker"><Sparkles size={14} /> Live delivery intelligence</span><h2>Everything moving,<br /><em>in one place.</em></h2><p>Track every handoff from pickup to doorstep. Your next delivery is almost there.</p><div className="hero-actions"><button className="button button-light" onClick={() => document.getElementById('tracking')?.scrollIntoView({ behavior: 'smooth' })}>Track a shipment <ArrowRight size={16} /></button><span className="hero-note"><span className="pulse" /> 98.4% on-time this month</span></div></div><div className="hero-visual"><div className="map-grid" /><div className="route-line route-one" /><div className="route-line route-two" /><span className="map-pin pin-one"><MapPin size={16} fill="currentColor" /></span><span className="map-pin pin-two"><MapPin size={16} fill="currentColor" /></span><div className="delivery-card"><span className="mini-label">Arriving today</span><strong>LM-48291</strong><span className="delivery-eta"><span className="pulse" /> 12–18 min</span></div></div></section>
    <div className="section-heading"><div><h2>At a glance</h2><span>Live snapshot of your account</span></div><button className="text-button">View activity <ArrowRight size={15} /></button></div>
    <div className="metrics-grid"><MetricCard label="Active shipments" value={String(visibleOrders.filter((order) => order.status !== 'Delivered').length)} icon={Package} accent="violet" /><MetricCard label="Delivered this month" value={String(visibleOrders.filter((order) => order.status === 'Delivered').length)} icon={Check} accent="teal" /><MetricCard label="Total spent" value={`₹${visibleOrders.reduce((sum, order) => sum + Number(order.amount.replace(/[^0-9.]/g, '') || 0), 0).toLocaleString('en-IN')}`} icon={CreditCard} accent="orange" /><MetricCard label="Saved addresses" value="04" icon={MapPin} accent="pink" /></div>
    <div className="content-grid"><section className="panel orders-panel" id="orders"><div className="panel-heading"><div><h2>Recent shipments</h2><span>{visibleOrders.length ? 'Synced from your account' : 'No shipments yet'}</span></div><button className="icon-button subtle" onClick={onCreate}><Plus size={18} /></button></div><div className="orders-list">{visibleOrders.length ? visibleOrders.map((order) => <div className="order-row" key={order.id}><div className={`order-icon ${order.tone}`}><Package size={18} /></div><div className="order-main"><div className="order-id">{order.trackingNumber} <span>·</span> <span className="order-date">{order.date}</span></div><strong>{order.route}</strong></div><StatusPill status={order.status} /><span className="order-amount">{order.amount}</span><button className="row-arrow" onClick={() => setTracking(order.trackingNumber)}><ArrowRight size={16} /></button></div>) : <div className="empty-state"><Package size={25} /><strong>Your shipment list is empty</strong><span>Create your first shipment to see it here.</span><button className="button button-primary" onClick={onCreate}><Plus size={15} /> Create shipment</button></div>}</div><button className="panel-footer" onClick={() => document.getElementById('tracking')?.scrollIntoView({ behavior: 'smooth' })}>Track a shipment <ArrowRight size={15} /></button></section><section className="panel tracking-panel" id="tracking"><div className="panel-heading"><div><h2>Track a shipment</h2><span>Get an instant status update</span></div><span className="tracking-badge"><Zap size={13} /> Fast</span></div><div className="tracking-form"><input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Enter tracking number" /><button className="button button-dark" onClick={() => setTracking(tracking.trim().toUpperCase())}>Track <ArrowRight size={15} /></button></div><div className="tracking-suggestion"><span>Try a recent shipment</span>{visibleOrders.slice(0, 1).map((order) => <button key={order.trackingNumber} onClick={() => setTracking(order.trackingNumber)}>{order.trackingNumber}</button>)}</div><div className="mini-timeline"><div className="timeline-item done"><span><Check size={13} /></span><div><strong>Created</strong><small>Order registered</small></div></div><div className="timeline-line active" /><div className="timeline-item current"><span><Truck size={13} /></span><div><strong>{tracking ? 'Tracking selected' : 'Awaiting tracking number'}</strong><small>{tracking || 'Enter an ID above to inspect your shipment'}</small></div></div><div className="timeline-line" /><div className="timeline-item"><span><MapPin size={13} /></span><div><strong>Delivered</strong><small>Final delivery event</small></div></div></div></section></div>
    <div className="insight-strip"><div className="insight-icon"><BarChart3 size={18} /></div><div><strong>Nice work, Aarav.</strong> You saved <b>₹640</b> with zone-optimized routes this month.</div><button className="text-button">See your impact <ArrowRight size={15} /></button></div>
  </>;
}

function AgentView({ liveOrders }: { liveOrders: LiveOrder[] }) {
  const [active, setActive] = useState('All');
  const deliveries = liveOrders.map((order, index) => ({ id: order.trackingNumber, address: order.raw?.recipientStreet || order.route, customer: order.raw?.recipientName || 'Recipient', status: order.status, time: index === 0 ? 'Next' : 'Queued', color: order.tone }));
  return <><div className="page-heading"><div><div className="eyebrow accent-eyebrow">Monday, 17 June 2024 · Shift 08:00–17:00</div><h1>Ready when you are, Arjun</h1><p>Your route is looking good. Here’s your day at a glance.</p></div><button className="button button-primary"><MapPin size={17} /> Open route</button></div><section className="agent-hero"><div><span className="hero-kicker"><span className="pulse" /> You’re online</span><h2>Make today<br /><em>count.</em></h2><p>4 deliveries left in your current route.</p></div><div className="route-stat"><div className="ring"><strong>68%</strong><span>route done</span></div><div><span className="mini-label">Current zone</span><strong>South Bengaluru</strong><span className="soft-text">2.8 km remaining</span></div></div></section><div className="metrics-grid"><MetricCard label="Deliveries today" value="8 / 12" change="+2" icon={Truck} accent="violet" /><MetricCard label="Earnings today" value="₹1,240" change="14%" icon={CreditCard} accent="teal" /><MetricCard label="On-time rate" value="96.8%" icon={Clock3} accent="orange" /><MetricCard label="Rating" value="4.92" icon={Sparkles} change="0.1" accent="pink" /></div><section className="panel deliveries-panel"><div className="panel-heading"><div><h2>Today’s route</h2><span>3 stops remaining · Updated just now</span></div><div className="filter-tabs">{['All', 'Pending', 'Done'].map((tab) => <button className={active === tab ? 'active' : ''} onClick={() => setActive(tab)} key={tab}>{tab}</button>)}</div></div><div className="delivery-table"><div className="table-head"><span>Shipment</span><span>Drop-off</span><span>Customer</span><span>Status</span><span>ETA</span><span /></div>{deliveries.filter((d) => active === 'All' || (active === 'Done' ? d.status === 'Delivered' : d.status !== 'Delivered')).map((delivery) => <div className="table-row" key={delivery.id}><div className="shipment-cell"><span className={`order-icon ${delivery.color}`}><Package size={16} /></span><strong>{delivery.id}</strong></div><span>{delivery.address}</span><span>{delivery.customer}</span><StatusPill status={delivery.status} /><strong>{delivery.time}</strong><button className="row-arrow"><ArrowRight size={16} /></button></div>)}</div></section></>;
}

function AdminView({ liveOrders, onExport }: { liveOrders: LiveOrder[]; onExport: () => void }) {
  const [filter, setFilter] = useState('All orders');
  const tableOrders = liveOrders;
  return <><div className="page-heading"><div><div className="eyebrow accent-eyebrow">Operations overview · Monday, 17 June</div><h1>Command center</h1><p>Monitor the network, keep promises, move faster.</p></div><div className="heading-actions"><button className="button button-ghost" onClick={onExport}><Download size={16} /> Export</button><button className="button button-primary"><Plus size={17} /> New order</button></div></div><div className="admin-metrics"><MetricCard label="Orders today" value={String(tableOrders.length)} icon={Package} accent="violet" /><MetricCard label="In transit" value={String(tableOrders.filter((o) => o.status === 'In Transit').length)} icon={Truck} accent="orange" /><MetricCard label="Delivered" value={String(tableOrders.filter((o) => o.status === 'Delivered').length)} icon={Check} accent="teal" /><MetricCard label="Exceptions" value="0" icon={Bell} accent="pink" /></div><div className="admin-grid"><section className="panel chart-panel"><div className="panel-heading"><div><h2>Network performance</h2><span>Orders processed across all zones</span></div><button className="select-button">Last 7 days <ChevronDown size={14} /></button></div><div className="chart"><div className="chart-labels"><span>300</span><span>200</span><span>100</span><span>0</span></div><div className="chart-area"><div className="grid-line one" /><div className="grid-line two" /><div className="grid-line three" /><svg viewBox="0 0 700 220" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#6d5dfc" stopOpacity=".24" /><stop offset="1" stopColor="#6d5dfc" stopOpacity="0" /></linearGradient></defs><path d="M0,171 C45,154 55,160 92,135 S142,142 185,119 S224,134 270,104 S324,109 365,82 S412,113 456,73 S500,88 545,58 S600,83 650,42 S680,54 700,22 L700,220 L0,220 Z" fill="url(#fill)" /><path d="M0,171 C45,154 55,160 92,135 S142,142 185,119 S224,134 270,104 S324,109 365,82 S412,113 456,73 S500,88 545,58 S600,83 650,42 S680,54 700,22" fill="none" stroke="#6d5dfc" strokeWidth="3" strokeLinecap="round" /></svg><div className="chart-days"><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span><span>Mon</span></div></div></div></section><section className="panel zone-panel"><div className="panel-heading"><div><h2>Zone health</h2><span>Live capacity by region</span></div><button className="icon-button subtle"><MoreHorizontal size={18} /></button></div><div className="zone-list">{[['South Bengaluru', '94%', 'good'], ['East Bengaluru', '81%', 'good'], ['Central Bengaluru', '68%', 'warn'], ['North Bengaluru', '42%', 'low']].map(([name, value, tone]) => <div className="zone-row" key={name}><div className="zone-name"><span className={`zone-swatch ${tone}`} /><strong>{name}</strong></div><div className="zone-bar"><span className={tone} style={{ width: value }} /></div><strong className="zone-value">{value}</strong></div>)}</div><button className="panel-footer">Manage zones <ArrowRight size={15} /></button></section></div><section className="panel admin-orders" id="orders"><div className="panel-heading"><div><h2>Live order queue</h2><span>{tableOrders.length} orders visible to your account</span></div><div className="heading-actions"><div className="filter-tabs">{['All orders', 'Exceptions', 'Unassigned'].map((tab) => <button className={filter === tab ? 'active' : ''} onClick={() => setFilter(tab)} key={tab}>{tab}</button>)}</div><button className="button button-ghost"><Filter size={15} /> Filters</button></div></div><div className="admin-table"><div className="table-head"><span>Tracking ID</span><span>Route</span><span>Agent</span><span>Status</span><span>Value</span><span>Updated</span></div>{tableOrders.map((order) => <div className="table-row" key={order.id}><strong>{order.trackingNumber}</strong><span>{order.route}</span><div className="agent-cell"><span className="unassigned">Awaiting assignment</span></div><StatusPill status={order.status} /><strong>{order.amount}</strong><span>{order.date}</span></div>)}</div></section><div className="agent-preview" id="agents"><div><span className="eyebrow">Dispatch team</span><h2>Agents on the ground</h2></div><div className="agent-avatars"><Avatar initials="AM" color="indigo" small /><Avatar initials="PS" color="orange" small /><Avatar initials="RD" color="slate" small /><Avatar initials="NK" color="teal" small /><span>+18</span></div><button className="text-button">View roster <ArrowRight size={15} /></button></div></>;
}

function CreateShipment({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(1);
  return <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}><div className="modal-header"><div><div className="eyebrow accent-eyebrow">New shipment · Step {step} of 2</div><h2>Create a shipment</h2></div><button className="icon-button subtle" onClick={onClose}><X size={19} /></button></div><div className="stepper"><span className="step active"><b>1</b> Route</span><span className="step-line" /><span className={`step ${step === 2 ? 'active' : ''}`}><b>2</b> Package</span></div>{step === 1 ? <div className="modal-body"><label>Pickup pincode<input placeholder="e.g. 560038" /></label><label>Drop-off pincode<input placeholder="e.g. 560034" /></label><div className="two-fields"><label>Pickup area<input placeholder="Indiranagar" /></label><label>Drop-off area<input placeholder="Koramangala" /></label></div><div className="quote-preview"><div><span className="mini-label">Estimated delivery</span><strong>Today · 2–4 hours</strong></div><div><span className="mini-label">From</span><strong>₹180 <small>onwards</small></strong></div></div><button className="button button-primary full-width" onClick={() => setStep(2)}>Continue to package <ArrowRight size={16} /></button></div> : <div className="modal-body"><label>Package description<input placeholder="What are you sending?" defaultValue="Documents & small parcel" /></label><div className="two-fields"><label>Weight (kg)<input placeholder="1.0" /></label><label>Payment type<select defaultValue="Prepaid"><option>Prepaid</option><option>Cash on delivery</option></select></label></div><label>Delivery notes<textarea placeholder="Anything your agent should know?" defaultValue="Please call on arrival." /></label><div className="quote-preview final"><div><span className="mini-label">Your quote</span><strong>₹248.00</strong></div><span className="soft-text">Includes taxes · no hidden fees</span></div><button className="button button-primary full-width" onClick={onClose}>Confirm shipment <Check size={16} /></button></div>}</div></div>;
}

function ConnectedShipmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (order: any) => void }) {
  const [form, setForm] = useState({ pickupPincode: '560038', dropPincode: '560034', senderName: 'Aarav Kapoor', senderPhone: '9876543210', senderStreet: '12, 100ft Road', senderCity: 'Bengaluru', senderState: 'Karnataka', recipientName: 'Meera Iyer', recipientPhone: '9876543211', recipientStreet: '42, 12th Main', recipientCity: 'Bengaluru', recipientState: 'Karnataka', packageLengthCm: '20', packageBreadthCm: '15', packageHeightCm: '10', actualWeightKg: '1', notes: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    setSaving(true); setError('');
    try {
      const payload = { ...form, packageLengthCm: Number(form.packageLengthCm), packageBreadthCm: Number(form.packageBreadthCm), packageHeightCm: Number(form.packageHeightCm), actualWeightKg: Number(form.actualWeightKg), isCod: false, codAmount: 0, declaredValue: 0, customerType: 'B2C' };
      const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to create shipment');
      onCreated(data); onClose();
    } catch (createError) { setError(createError instanceof Error ? createError.message : 'Unable to create shipment'); } finally { setSaving(false); }
  };
  const field = (key: string, label: string, placeholder: string) => <label>{label}<input value={(form as any)[key]} onChange={(event) => update(key, event.target.value)} placeholder={placeholder} /></label>;
  return <div className="modal-backdrop" onClick={onClose}><div className="modal create-modal" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><div className="eyebrow accent-eyebrow">New shipment · saved to your account</div><h2>Create a shipment</h2></div><button className="icon-button subtle" onClick={onClose}><X size={19} /></button></div><div className="modal-body">{field('recipientName', 'Recipient name', 'Who is receiving it?')}<div className="two-fields">{field('pickupPincode', 'Pickup pincode', '560038')}{field('dropPincode', 'Drop-off pincode', '560034')}</div><div className="two-fields">{field('senderStreet', 'Pickup address', 'Street and building')}{field('recipientStreet', 'Drop-off address', 'Street and building')}</div><div className="two-fields">{field('senderPhone', 'Sender phone', '10-digit number')}{field('recipientPhone', 'Recipient phone', '10-digit number')}</div><div className="two-fields">{field('packageLengthCm', 'Length (cm)', '20')}{field('packageBreadthCm', 'Breadth (cm)', '15')}</div><div className="two-fields">{field('packageHeightCm', 'Height (cm)', '10')}{field('actualWeightKg', 'Weight (kg)', '1')}</div>{field('notes', 'Delivery notes (optional)', 'Anything your agent should know?')}{error && <p className="login-error">{error}</p>}<div className="quote-preview"><div><span className="mini-label">Live quote</span><strong>Calculated from your route</strong></div><span className="soft-text">Final price on confirmation</span></div><button className="button button-primary full-width" disabled={saving} onClick={submit}>{saving ? 'Creating shipment…' : 'Confirm shipment'} {!saving && <Check size={16} />}</button></div></div></div>;
}

export function Dashboard() {
  const pathname = usePathname();
  const router = useRouter();
  const role: Role = pathname.includes('/admin') ? 'admin' : pathname.includes('/agent') ? 'agent' : 'customer';
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [liveOrders, setLiveOrders] = useState<LiveOrder[]>([]);
  useEffect(() => {
    fetch('/api/orders?limit=50')
      .then(async (response) => { if (response.status === 401) { router.push('/login'); return null; } if (!response.ok) throw new Error('Unable to load orders'); return response.json(); })
      .then((data) => { if (!data?.orders) return; setLiveOrders(data.orders.map((order: any, index: number) => ({ id: order.id, trackingNumber: order.trackingNumber, route: `${order.pickupZone?.name || order.pickupPincode} → ${order.dropZone?.name || order.dropPincode}`, status: String(order.currentStatus || 'CREATED').replaceAll('_', ' ').replace(/\b\w/g, (char: string) => char.toUpperCase()), date: new Date(order.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }), amount: `₹${Number(order.totalAmount || 0).toLocaleString('en-IN')}`, tone: ['pink', 'amber', 'green', 'cyan'][index % 4], raw: order }))); })
      .catch(() => undefined);
  }, [router, role]);
  const handleLogout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.replace('/login'); router.refresh(); };
  const exportOrders = () => { const header = 'Tracking ID,Route,Status,Amount,Updated'; const rows = liveOrders.map((order) => [order.trackingNumber, order.route, order.status, order.amount, order.date].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')); const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `lastmile-orders-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url); };
  const content = role === 'customer' ? <CustomerView customerOrders={liveOrders} onCreate={() => setShowCreate(true)} /> : role === 'agent' ? <AgentView liveOrders={liveOrders} /> : <AdminView liveOrders={liveOrders} onExport={exportOrders} />;
  return <div className="app-shell"><Sidebar role={role} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} onLogout={handleLogout} /><div className="app-main"><Topbar role={role} setMobileOpen={setMobileOpen} onLogout={handleLogout} /><main className="main-content">{content}</main><footer className="app-footer"><span>lastmile<span className="brand-dot">.</span> operations platform</span><span>All systems operational <span className="pulse" /></span></footer></div>{showCreate && <ConnectedShipmentModal onCreated={(order) => setLiveOrders((current) => [{ id: order.id, trackingNumber: order.trackingNumber, route: `${order.pickupPincode} → ${order.dropPincode}`, status: 'Created', date: 'Just now', amount: `₹${Number(order.totalAmount || 0).toLocaleString('en-IN')}`, tone: 'violet', raw: order }, ...current])} onClose={() => setShowCreate(false)} />}</div>;
}

function LoginScreen() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('customer');
  const [email, setEmail] = useState('customer@lastmile.local');
  const [password, setPassword] = useState('Password123!');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const roleDefaults: Record<Role, string> = { customer: 'customer@lastmile.local', agent: 'agent1@lastmile.local', admin: 'admin@lastmile.local' };
  const handleRole = (nextRole: Role) => { setRole(nextRole); setEmail(roleDefaults[nextRole]); setError(''); };
  const handleLogin = async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to sign in');
      if (data.user?.role !== role.toUpperCase()) throw new Error(`This account belongs to the ${String(data.user?.role || '').toLowerCase()} workspace.`);
      const redirect = new URLSearchParams(window.location.search).get('redirect');
      router.push(redirect || (role === 'customer' ? '/customer' : role === 'agent' ? '/agent' : '/admin'));
    } catch (loginError) { setError(loginError instanceof Error ? loginError.message : 'Unable to sign in'); } finally { setLoading(false); }
  };
  return <main className="login-page"><div className="login-brand"><span className="brand-mark"><Zap size={17} fill="currentColor" /></span><span>lastmile<span className="brand-dot">.</span></span></div><div className="login-layout"><section className="login-intro"><span className="hero-kicker"><Sparkles size={14} /> The delivery operating system</span><h1>Move every<br /><em>promise</em> forward.</h1><p>One calm, clear workspace for the people sending, moving, and managing what matters.</p><div className="login-proof"><div className="proof-avatars"><Avatar initials="AM" color="indigo" small /><Avatar initials="PS" color="orange" small /><Avatar initials="NK" color="teal" small /></div><span>Trusted by teams moving<br /><strong>12,000+ deliveries every week</strong></span></div></section><section className="login-card"><div className="login-card-header"><div className="eyebrow accent-eyebrow">Welcome back</div><h2>Sign in to lastmile.</h2><p>Choose your workspace to continue.</p></div><div className="login-roles">{[['customer', UserRound, 'Customer', 'Send and track shipments'], ['agent', Truck, 'Agent', 'Manage your delivery route'], ['admin', ShieldCheck, 'Admin', 'Run the operations center']].map(([value, Icon, title, description]) => <button key={value as string} className={`login-role ${role === value ? 'selected' : ''}`} onClick={() => handleRole(value as Role)}><span className={`login-role-icon workspace-${value}`}><Icon size={17} /></span><span><strong>{title as string}</strong><small>{description as string}</small></span><span className="login-radio" /></button>)}</div><label className="login-label">Work email<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></label><label className="login-label">Password<div className="password-input"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" /><button type="button">Forgot?</button></div></label>{error && <p className="login-error">{error}</p>}<button className="button button-primary full-width login-submit" onClick={handleLogin} disabled={loading}>{loading ? 'Signing you in…' : `Continue to ${role} workspace`} {!loading && <ArrowRight size={16} />}</button><p className="login-terms">By continuing, you agree to our <span>Terms of service</span> and <span>Privacy policy</span>.</p></section></div><div className="login-footer"><span>© 2024 lastmile. Built for the last mile.</span><span><span className="pulse" /> All systems operational</span></div></main>;
}

export default function HomePage() {
  const pathname = usePathname();
  return pathname === '/' || pathname === '/login' ? <LoginScreen /> : <Dashboard />;
}
