import { useEffect, useRef } from 'react';
import { init, use, type EChartsCoreOption } from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

use([BarChart, LineChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer]);

export default function AdminChart({ option, label }: { option: EChartsCoreOption; label: string }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<ReturnType<typeof init>>();

  useEffect(() => {
    if (!container.current) return;
    const instance = init(container.current);
    chart.current = instance;
    let resizeRafId = 0;
    const observer = new ResizeObserver(() => {
      if (resizeRafId) return;
      resizeRafId = window.requestAnimationFrame(() => {
        resizeRafId = 0;
        const el = container.current;
        if (!el || el.clientWidth <= 0 || el.clientHeight <= 0) return;
        instance.resize();
      });
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      if (resizeRafId) window.cancelAnimationFrame(resizeRafId);
      chart.current = undefined;
      instance.dispose();
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption({
      ...option,
      animation: false,
      aria: { enabled: true },
      textStyle: { fontFamily: 'system-ui, sans-serif' },
    }, { notMerge: true });
  }, [option]);

  return <div ref={container} className="admin-chart" role="img" aria-label={label} />;
}
