import { useLayoutEffect, useRef, useState } from 'react';
import { Palette } from 'lucide-react';

const themes = {
  system: { name: 'System', colors: ['#f9faf7', '#25322c', '#72957f'] },
  light: { name: 'Light', colors: ['#fff', '#edf3ed', '#356548'] },
  dark: { name: 'Dark', colors: ['#1b211e', '#334a3b', '#9bc9a8'] },
  sepia: { name: 'Sepia', colors: ['#fcf7eb', '#ebdcc0', '#795137'] },
  paper: { name: 'Paper', colors: ['#fafaf9', '#e7e7e5', '#424348'] },
  dawn: { name: 'Dawn', colors: ['#fff9f7', '#f6e4e5', '#9c4b66'] },
  nord: { name: 'Nord', colors: ['#2b3341', '#435268', '#a8c8e0'] },
  midnight: { name: 'Midnight', colors: ['#171927', '#313354', '#beb4f0'] }
};

function initialTheme() {
  try {
    const value = localStorage.getItem('mdreader:theme');
    return Object.hasOwn(themes, value) ? value : 'system';
  } catch { return 'system'; }
}

export default function ThemeControl() {
  const [theme, setTheme] = useState(initialTheme);
  const menu = useRef(null);
  const trigger = useRef(null);

  useLayoutEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    function apply() {
      const root = document.documentElement;
      root.dataset.theme = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme;
      const background = getComputedStyle(root).getPropertyValue('--chrome').trim();
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
    }
    apply();
    if (theme === 'system') system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [theme]);

  function change(value) {
    setTheme(value);
    try { localStorage.setItem('mdreader:theme', value); } catch {}
    menu.current?.hidePopover();
    trigger.current?.focus();
  }

  return <>
    <button ref={trigger} type="button" className="icon-button theme-trigger" aria-label="Color theme"
      title={'Color theme · ' + themes[theme].name} popovertarget="theme-picker"><Palette size={18} /></button>
    <div id="theme-picker" ref={menu} className="theme-picker" popover="auto" aria-labelledby="theme-heading">
      <h2 id="theme-heading">Color theme</h2>
      <div className="theme-choices" role="group" aria-label="Available themes">
        {Object.entries(themes).map(([value, { name, colors }]) =>
          <button type="button" key={value} aria-pressed={value === theme} onClick={() => change(value)}>
            <span className="theme-swatch" aria-hidden="true">
              {colors.map(color => <i key={color} style={{ background: color }} />)}
            </span>
            <span>{name}</span>
          </button>)}
      </div>
    </div>
  </>;
}
