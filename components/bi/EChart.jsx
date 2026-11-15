"use client";
// components/bi/EChart.jsx — minimal Apache ECharts wrapper (no third-party
// React binding, so no React-19 peer issues). Loads echarts on the client,
// redraws on option change, follows its container's size.
import { useEffect, useRef } from "react";

export default function EChart({ option, height = 280, onClick }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;
  const optionRef = useRef(option);
  optionRef.current = option;

  useEffect(() => {
    let disposed = false;
    let ro;
    (async () => {
      const echarts = await import("echarts");
      if (disposed || !ref.current) return;
      chartRef.current = echarts.init(ref.current, null, { renderer: "canvas" });
      chartRef.current.setOption(optionRef.current, true);
      chartRef.current.on("click", (p) => clickRef.current?.(p));
      ro = new ResizeObserver(() => chartRef.current?.resize());
      ro.observe(ref.current);
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
    // init once; option updates below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={ref} style={{ width: "100%", height, cursor: onClick ? "pointer" : undefined }} title={onClick ? "Click a bar / slice to see its records" : undefined} />;
}
