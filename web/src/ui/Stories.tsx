import { useState } from 'react';
import type { StoryScenario, Tab } from '../App';
import { Icon } from './Icon';

const D = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);
const STAY = 156; // 6.5 days, the planned crewed surface stay
const LUNAR_DAY = 708.7;

interface Story {
  title: string;
  text: string;
  tab: Tab;
  list: StoryScenario[];
}

// Picked by scanning every landing date from Nov 2026 to Nov 2027 at the curated south polar sites.
const STORIES: Story[] = [
  {
    title: 'The ridge where the Sun never sets',
    text: 'At the best-lit point near Shackleton crater the Sun stays up for a whole lunar day. Earth is another matter.',
    tab: 'explore',
    list: [{ siteId: 'connecting-ridge', startMs: D(2026, 11, 14), durationH: LUNAR_DAY, minEarthEl: 0 }],
  },
  {
    title: 'A three-day slip doubles the sunlight',
    text: 'Mons Mouton Plateau, one of NASA’s candidate regions, for a 6.5-day crewed stay landing on Dec 16 or Dec 19, 2026.',
    tab: 'compare',
    list: [
      { siteId: 'mons-mouton-plateau', startMs: D(2026, 12, 16), durationH: STAY, minEarthEl: 0 },
      { siteId: 'mons-mouton-plateau', startMs: D(2026, 12, 19), durationH: STAY, minEarthEl: 0 },
    ],
  },
  {
    title: 'Three days later, Earth drops out of view',
    text: 'Nobile Rim 2, landing Feb 17 or Feb 20, 2027. The later date loses half its sunlight and most of its direct link to Earth.',
    tab: 'compare',
    list: [
      { siteId: 'nobile-rim-2', startMs: D(2027, 2, 17), durationH: STAY, minEarthEl: 0 },
      { siteId: 'nobile-rim-2', startMs: D(2027, 2, 20), durationH: STAY, minEarthEl: 0 },
    ],
  },
  {
    title: 'Sunset at the IM-1 Odysseus site',
    text: 'Start the clock at the real landing time on Feb 22, 2024 and watch the Sun sink behind the terrain.',
    tab: 'explore',
    list: [{ siteId: 'odysseus', startMs: D(2024, 2, 22, 23, 23), durationH: 336, minEarthEl: 0 }],
  },
];

const KEY = 'lsn-stories-hidden';

function readHidden(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function Stories({ onStory }: { onStory: (list: StoryScenario[], tab: Tab) => void }) {
  const [hidden, setHidden] = useState(readHidden);
  const hide = (v: boolean) => {
    setHidden(v);
    try {
      localStorage.setItem(KEY, v ? '1' : '0');
    } catch {
      /* storage blocked: the choice lasts for this visit only */
    }
  };
  if (hidden)
    return (
      <button className="btn ghost small" type="button" style={{ alignSelf: 'flex-start' }} onClick={() => hide(false)}>
        Show example scenarios
      </button>
    );
  return (
    <section className="panel panel-pad stories" aria-labelledby="stories-h">
      <div className="panel-head">
        <h2 id="stories-h">Start here</h2>
        <button className="btn ghost small" type="button" onClick={() => hide(true)}>
          Hide
        </button>
      </div>
      <p className="stories-intro">
        At the lunar south pole the Sun circles the horizon and Earth hangs low, so a few days or a few kilometres can decide whether a lander has power and a
        link home. Open one of these real cases, or set up your own with the scenario controls.
      </p>
      <div className="story-grid">
        {STORIES.map((s) => (
          <button key={s.title} type="button" className="story" onClick={() => onStory(s.list, s.tab)}>
            <span className="story-title">{s.title}</span>
            <span className="story-text">{s.text}</span>
            <span className="story-go">
              {s.tab === 'compare' ? 'Compare both dates' : 'Open in Explore'}
              <span className="story-disc">
                <Icon name="arrowRight" size={14} />
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
