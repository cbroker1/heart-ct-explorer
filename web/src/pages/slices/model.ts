/** One function turns the stores into the per-viewport model, for both the GL controller and React chrome. */
import { useMemo } from 'react'
import type { Manifest, Vec3 } from '../../lib/data'
import { useApp } from '../../lib/store'
import { buildSlots, type SlotModel } from './geom'
import { useLoad, useSlc } from './state'

/** Series keys actually on screen: the requested ones once their textures are ready, else the previous ones. */
export function displayKeys(): { main: string; partner: string } {
  const shown = useLoad.getState().shown
  return {
    main: shown.main ?? useApp.getState().sliceSeries,
    partner: shown.partner ?? useSlc.getState().partner,
  }
}

export function modelFromState(manifest: Manifest): SlotModel[] {
  const slc = useSlc.getState()
  const { size } = useLoad.getState()
  const cursor = useApp.getState().cursor ?? manifest.worldCenterLPS
  const k = displayKeys()
  return buildSlots({
    manifest, layout: slc.layout, plane: slc.plane, mainKey: k.main, partnerKey: k.partner,
    W: size.w, H: size.h, xf: slc.xf, cursor,
  })
}

export function useSlots(manifest: Manifest): SlotModel[] {
  const cursor = useApp((s) => s.cursor) ?? manifest.worldCenterLPS
  const req = useApp((s) => s.sliceSeries)
  const layout = useSlc((s) => s.layout)
  const plane = useSlc((s) => s.plane)
  const partner = useSlc((s) => s.partner)
  const xf = useSlc((s) => s.xf)
  const shown = useLoad((s) => s.shown)
  const size = useLoad((s) => s.size)
  return useMemo(
    () => buildSlots({
      manifest, layout, plane,
      mainKey: shown.main ?? req, partnerKey: shown.partner ?? partner,
      W: size.w, H: size.h, xf, cursor: cursor as Vec3,
    }),
    [manifest, layout, plane, shown, req, partner, size, xf, cursor],
  )
}
