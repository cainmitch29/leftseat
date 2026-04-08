function maxRunwayLength(airport: any): number {
  if (!airport.runways || airport.runways.length === 0) return 0;
  return Math.max(...airport.runways.map((r: any) => r.length || 0));
}

type NearbyPlaces = {
  restaurants: any[];
  hotels: any[];
  golf: any[];
  things: any[];
};

export type WhyCategory = 'food' | 'golf' | 'stay' | 'scenic' | 'event' | 'airport';

export interface WhyItem {
  text: string;
  category: WhyCategory;
  /** 1 = strongest (destination-driven), 3 = generic filler */
  priority: 1 | 2 | 3;
  icon: string;
}

const CHAIN_NAMES = [
  "mcdonald's", "burger king", "wendy's", "taco bell", "kfc", "kentucky fried",
  "subway", "pizza hut", "domino's", "chick-fil-a", "popeyes", "arby's",
  "dairy queen", "little caesars", "panda express", "sonic drive-in", "sonic",
  "applebee's", "chili's", "ihop", "denny's", "olive garden", "red lobster",
  "outback steakhouse", "panera bread", "panera", "starbucks", "dunkin'", "dunkin",
  "jack in the box", "hardee's", "carl's jr", "five guys", "wingstop",
  "raising cane's", "culver's", "cracker barrel", "red robin", "buffalo wild wings",
  "dollar general", "dollar tree", "family dollar", "autozone", "o'reilly auto",
];

const DESTINATION_KEYWORDS = [
  "brewery", "brewpub", "brew pub", "taproom", "tap room", "craft beer", "alehouse",
  "winery", "vineyard", "distillery", "cidery",
  "steakhouse", "steak house", "seafood", "lobster", "crab", "oyster",
  "bbq", "barbecue", "smokehouse", "barbeque",
  "airport", "airfield", "fly-in",
  "golf", "country club",
  "national park", "state park", "preserve", "wilderness",
  "museum", "historic", "heritage",
  "waterfront", "lakefront", "oceanfront", "rooftop",
  "roadhouse", "tavern", "gastropub",
];

function placeScore(p: any): number {
  const name = (p.name || '').toLowerCase();
  const type = (p.type || '').toLowerCase();
  const rating = parseFloat(p.rating) || 0;
  const reviews = parseInt((p.rating || '').match(/\((\d+)\)/)?.[1] || '0') || 0;
  const ratingScore = rating * (1 + Math.log10(Math.max(reviews, 1) + 1) * 0.5);
  const dist = p.distanceMiles ?? 10;
  const distPenalty = dist * 0.3;
  const isChain = CHAIN_NAMES.some(c => name.includes(c));
  const chainPenalty = isChain ? 5 : 0;
  const isDestination = DESTINATION_KEYWORDS.some(k => name.includes(k) || type.includes(k));
  const destinationBonus = isDestination ? 2 : 0;
  return ratingScore - distPenalty - chainPenalty + destinationBonus;
}

function bestPlace(list: any[]): any | null {
  const nearby = (list || []).filter(p => p.distanceMiles != null && p.distanceMiles <= 10);
  if (nearby.length === 0) return null;
  return nearby.sort((a, b) => placeScore(b) - placeScore(a))[0];
}

/** Format distance consistently: always "X.X mi" with one decimal */
function fmtDist(mi: number): string {
  return `${Math.round(mi * 10) / 10} mi`;
}

/**
 * Generates structured "Why fly here" items from airport data and optional nearby places.
 * Returns sorted by priority (strongest reasons first).
 * Hides generic filler when 3+ destination reasons exist.
 */
export function getWhyFlyHere(airport: any, places?: NearbyPlaces): WhyItem[] {
  const items: WhyItem[] = [];
  // has_tower values: ATCT, ATCT-TRACON, ATCT-RAPCON, ATCT-A/C, NON-ATCT
  const hasTower = airport.has_tower?.startsWith('ATCT') ?? false;
  const hasFuel  = !!airport.fuel;
  const rl = maxRunwayLength(airport);

  // ── Airport-utility bullet (priority 2 or 3) ──────────────────────────────
  if (hasTower && hasFuel) {
    items.push({ text: 'Towered field with fuel on the ramp', category: 'airport', priority: 2, icon: 'radio-tower' });
  } else if (hasFuel && rl >= 5000) {
    items.push({ text: `${rl.toLocaleString()} ft runway with fuel available`, category: 'airport', priority: 2, icon: 'gas-station' });
  } else if (hasFuel) {
    items.push({ text: 'Fuel on the field — convenient cross-country waypoint', category: 'airport', priority: 3, icon: 'gas-station' });
  } else if (hasTower) {
    items.push({ text: 'Controlled field with a predictable pattern', category: 'airport', priority: 3, icon: 'radio-tower' });
  } else if (rl >= 5000) {
    items.push({ text: `${rl.toLocaleString()} ft runway — handles most GA aircraft`, category: 'airport', priority: 2, icon: 'arrow-collapse-right' });
  } else {
    items.push({ text: 'Friendly GA airport with a relaxed atmosphere', category: 'airport', priority: 3, icon: 'airplane' });
  }

  // ── Destination bullets from live nearby places ────────────────────────────
  if (places) {
    const topRest  = bestPlace(places.restaurants);
    const topGolf  = bestPlace(places.golf);
    const topHotel = bestPlace(places.hotels);
    const topThing = bestPlace(places.things);

    if (topRest) {
      const rating = parseFloat(topRest.rating) || 0;
      const dist = fmtDist(topRest.distanceMiles);
      if (rating >= 4.5) {
        items.push({ text: `${topRest.name} — ${dist}, top-rated in the area`, category: 'food', priority: 1, icon: 'silverware-fork-knife' });
      } else if (rating >= 4.0) {
        items.push({ text: `${topRest.name} — ${dist} from the ramp`, category: 'food', priority: 1, icon: 'silverware-fork-knife' });
      } else {
        items.push({ text: `Dining ${dist} from the field`, category: 'food', priority: 2, icon: 'silverware-fork-knife' });
      }
    }

    if (topGolf) {
      const dist = fmtDist(topGolf.distanceMiles);
      items.push({ text: `${topGolf.name} — ${dist}`, category: 'golf', priority: 1, icon: 'golf-tee' });
    }

    if (topHotel) {
      const dist = fmtDist(topHotel.distanceMiles);
      items.push({ text: `Lodging ${dist} away — easy overnight stop`, category: 'stay', priority: 1, icon: 'bed-outline' });
    }

    if (topThing) {
      const dist = fmtDist(topThing.distanceMiles);
      items.push({ text: `${topThing.name} — ${dist}`, category: 'event', priority: 1, icon: 'flag-variant' });
    }
  } else {
    // ── Fallback from static airport fields ──────────────────────────────────
    if (airport.restaurant) items.push({ text: 'Local food scene worth the flight', category: 'food', priority: 2, icon: 'silverware-fork-knife' });
    if (airport.golf)       items.push({ text: 'Golf nearby — fly in, play a round', category: 'golf', priority: 2, icon: 'golf-tee' });
    if (airport.hotel)      items.push({ text: 'Overnight options for a weekend getaway', category: 'stay', priority: 2, icon: 'bed-outline' });
    if (airport.attraction) items.push({ text: 'Local attractions worth exploring', category: 'event', priority: 2, icon: 'flag-variant' });
    if (airport.courtesy_car) items.push({ text: 'Courtesy car available', category: 'airport', priority: 2, icon: 'car' });
  }

  // ── Filler (only used if we have fewer than 2 items) ───────────────────────
  if (items.length < 2) {
    const location = [airport.city, airport.state].filter(Boolean).join(', ');
    if (location) {
      items.push({ text: `${location} — small-town destination`, category: 'scenic', priority: 3, icon: 'map-marker' });
    } else {
      items.push({ text: 'Quiet field in an area worth exploring', category: 'scenic', priority: 3, icon: 'map-marker' });
    }
  }

  // ── Sort: destination-driven first, generic last ───────────────────────────
  items.sort((a, b) => a.priority - b.priority);

  // If we have 3+ destination/supporting reasons (priority 1–2), hide generic filler (priority 3)
  const strongCount = items.filter(i => i.priority <= 2).length;
  const filtered = strongCount >= 3 ? items.filter(i => i.priority <= 2) : items;

  return filtered.slice(0, 4);
}
