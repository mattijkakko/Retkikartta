import { SPEEDS, COND_COEFF } from './utils.js'

export const st = $state({
  // Map & layers
  activeBase: 'taustakartta',
  searchOpen: false,
  hikeOn: false,
  // Menus
  openMenu: null,           // 'layer' | 'mode' | 'gps' | 'action' | null
  // Drawing
  activeDrawMode: null,     // 'draw' | 'freehand' | 'routing' | null
  // Route
  waypoints: [],
  wpTypes: [],
  history: [],
  routeElevations: [],
  // GPS
  tracking: false,
  trackPts: [],
  trackStart: null,
  centerLocked: true,
  // Mode & conditions
  currentMode: 'walk',
  currentCond: 'summer',
  runSpeed: 9.0,
  // Elevation display
  currentEle: '– m',
  // Toast
  toastMsg: '',
  toastVisible: false,
})

let toastTimer = null
export function showToast(msg) {
  st.toastMsg = msg
  st.toastVisible = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { st.toastVisible = false }, 2500)
}

export function baseSpeed() {
  return (st.currentMode === 'run' ? st.runSpeed : SPEEDS[st.currentMode]) * COND_COEFF[st.currentCond]
}
