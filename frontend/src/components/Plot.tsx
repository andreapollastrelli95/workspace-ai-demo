import { useEffect, useRef } from 'react'

/** Grafico Plotly interattivo, caricato on-demand (non appesantisce l'avvio dell'app). */
export default function Plot({ figure, height = 340 }: { figure: any; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    let Plotly: any
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const mobile = window.innerWidth < 768
    import('plotly.js-dist-min').then((m) => {
      if (!alive || !ref.current) return
      Plotly = m.default ?? m
      const layout = {
        ...figure.layout, height, autosize: true,
        paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
        font: { family: 'Inter, system-ui', size: mobile ? 11 : 12, color: dark ? '#cbd5e1' : '#334155' },
        margin: mobile ? { l: 36, r: 8, t: 40, b: 36 } : figure.layout?.margin,
        legend: mobile ? { orientation: 'h', y: -0.2 } : figure.layout?.legend,
        title: { ...(figure.layout?.title || {}), font: { size: mobile ? 13 : 15 } },
        ...(dark ? { xaxis: { ...figure.layout?.xaxis, gridcolor: '#26315a' }, yaxis: { ...figure.layout?.yaxis, gridcolor: '#26315a' } } : {}),
      }
      Plotly.react(ref.current, figure.data, layout, { responsive: true, displaylogo: false, displayModeBar: !mobile, locale: 'it' })
    })
    return () => { alive = false; if (Plotly && ref.current) Plotly.purge(ref.current) }
  }, [figure, height])
  return <div ref={ref} className="w-full" style={{ minHeight: height }} />
}
