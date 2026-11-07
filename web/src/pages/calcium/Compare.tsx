import { useEffect, useState, type FormEvent } from 'react'
import { cacCategory, fmtNum, fmtScore, groupName, percentileBracket } from './model'
import type { CalciumVM } from './useCalciumData'

function verdictText(vm: CalciumVM, off: number): { tone: 'good' | 'info' | 'warn'; head: string; body: string } {
  const diy = vm.report.totals.agatston
  const pc = vm.report.percentileContext
  const row = pc?.rows?.[0]
  const ctx = off > 0
    ? ` An official ${fmtNum(off, 1)} is "${cacCategory(off).label.toLowerCase()}" (${cacCategory(off).range})${row ? ` and ${percentileBracket(off, row).long} for ${groupName(row.group)} aged ${pc!.age}` : ''}.`
    : ''
  const prov = vm.report.reviewed ? '' : ' (Mine is still provisional until the AI review is merged.)'
  if (Math.abs(off - diy) < 0.5) {
    return off === 0
      ? { tone: 'good', head: 'Perfect agreement: zero and zero.', body: `The hospital's calibrated workstation and my homemade pipeline both found no coronary calcium. Nice.${prov}` }
      : { tone: 'good', head: 'Same number, give or take.', body: `Both land at about ${fmtNum(off, 1)}.${ctx}${prov}` }
  }
  if (diy === 0 && off > 0) {
    // still-pending candidates if any, otherwise the borderline ones the reviewers dismissed
    const pool = vm.pending.length ? { n: vm.pending.length, worst: vm.worstCase } : vm.borderline.length ? { n: vm.borderline.length, worst: vm.borderlineWorst } : null
    const near = !!pool && pool.worst > 0 && Math.abs(pool.worst - off) <= Math.max(2, off * 0.35)
    const nearTxt = near && pool
      ? ` Interesting: if ${pool.n === 1 ? 'the borderline candidate' : `all ${pool.n} borderline candidates`} had been real plaque, I'd get ${fmtScore(+pool.worst.toFixed(1))}, close to the official score${vm.pending.length ? '' : ` (the AI reviewers called ${pool.n === 1 ? 'it' : 'them'} noise)`}.`
      : ''
    return {
      tone: 'warn',
      head: 'The radiologist found calcium my pipeline did not count.',
      body: `Trust the official number: radiologists trace the actual arteries on a calibrated workstation, while I used rules and AI judgement on a noisy low-dose scan.${ctx}${nearTxt} Worth asking your doctor what it means for you.${prov}`,
    }
  }
  if (diy > 0 && off === 0) {
    return {
      tone: 'info',
      head: 'The official score is zero; mine is not.',
      body: `The official zero wins. My ${fmtScore(diy)} most likely comes from specks a human reader dismissed as noise. Open the candidate gallery above to see what I counted.${prov}`,
    }
  }
  const diff = diy - off
  return {
    tone: 'info',
    head: `${fmtNum(Math.abs(diff), 1)} points apart (${diff > 0 ? 'mine is higher' : 'mine is lower'}).`,
    body: `Small scores vary between software packages and readers, so a few points' difference is normal. The official number is the one that counts.${ctx}${prov}`,
  }
}

export default function Compare({ vm, official, setOfficial }: { vm: CalciumVM; official: number | null; setOfficial: (v: number | null) => void }) {
  const [draft, setDraft] = useState(official === null ? '' : String(official))
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setDraft(official === null ? '' : String(official)) }, [official])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = draft.trim().replace(',', '.')
    if (t === '') { setOfficial(null); setErr(null); return }
    const n = Number(t)
    if (!Number.isFinite(n) || n < 0 || n > 20000) { setErr('Enter the Agatston number from your report, e.g. 0 or 12.5.'); return }
    setErr(null)
    setOfficial(Math.round(n * 10) / 10)
  }
  const diy = vm.report.totals.agatston
  const res = official !== null ? verdictText(vm, official) : null
  return (
    <div className="cal-compare">
      <form className="cal-compare-form" onSubmit={submit}>
        <label htmlFor="cal-official">
          <span className="eyebrow">Official Agatston score</span>
          <span className="muted" style={{ fontSize: 12 }}>From the radiologist's report (look for "Agatston" or "calcium score"). Saved only in this browser.</span>
        </label>
        <div className="row" style={{ gap: 8 }}>
          <input id="cal-official" className="cal-input mono" type="text" inputMode="decimal" autoComplete="off" placeholder="e.g. 0"
            value={draft} onChange={(e) => setDraft(e.target.value)} aria-invalid={!!err} aria-describedby={err ? 'cal-official-err' : undefined} />
          <button className="btn primary" type="submit">Compare</button>
          {official !== null && <button className="btn ghost" type="button" onClick={() => { setOfficial(null); setDraft('') }}>Clear</button>}
        </div>
        {err && <div id="cal-official-err" className="cal-err">{err}</div>}
      </form>
      <div className={`cal-compare-res ${res ? res.tone : 'empty'}`} aria-live="polite">
        <div className="cal-vs">
          <div><span className="eyebrow">DIY</span><b className="mono">{fmtScore(diy)}</b></div>
          <div className="cal-vs-sign">{official === null ? 'vs' : Math.abs(official - diy) < 0.5 ? '=' : '≠'}</div>
          <div><span className="eyebrow">Official</span><b className="mono" style={{ color: official === null ? 'var(--faint)' : 'var(--cyan-2)' }}>{official === null ? '?' : fmtNum(official, 1)}</b></div>
        </div>
        {res ? (
          <div>
            <h3>{res.head}</h3>
            <p>{res.body}</p>
          </div>
        ) : (
          <p className="muted">Type the number from your official report to see how my homemade score stacks up.</p>
        )}
      </div>
    </div>
  )
}
