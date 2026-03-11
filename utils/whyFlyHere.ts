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

// Known generic chains that are not destination-worthy for pilots
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

// Keywords that suggest a place is destination-worthy
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

/** Score a place for how worthwhile it is as a fly-in destination. */
function placeScore(p: any): number {
  const name = (p.name || '').toLowerCase();
  const type = (p.type || '').toLowerCase();

  // Rating weighted by review count (more reviews = more reliable signal)
  const rating = parseFloat(p.rating) || 0;
  const reviews = parseInt((p.rating || '').match(/\((\d+)\)/)?.[1] || '0') || 0;
  const ratingScore = rating * (1 + Math.log10(Math.max(reviews, 1) + 1) * 0.5);

  // Mild distance penalty — closer is better, but don't overwhelm quality signal
  const dist = p.distanceMiles ?? 10;
  const distPenalty = dist * 0.3;

  // Heavy penalty for known generic chains
  const isChain = CHAIN_NAMES.some(c => name.includes(c));
  const chainPenalty = isChain ? 5 : 0;

  // Bonus for destination-worthy types
  const isDestination = DESTINATION_KEYWORDS.some(k => name.includes(k) || type.includes(k));
  const destinationBonus = isDestination ? 2 : 0;

  return ratingScore - distPenalty - chainPenalty + destinationBonus;
}

/** Returns the best place from a list using destination-aware scoring. */
function bestPlace(list: any[]): any | null {
  const nearby = (list || []).filter(p => p.distanceMiles != null && p.distanceMiles <= 10);
  if (nearby.length === 0) return null;
  return nearby.sort((a, b) => placeScore(b) - placeScore(a))[0];
}

/**
 * Generates "Why fly here" bullets from airport data and optional nearby places.
 * Used by both the map preview sheet and the full airport screen
 * so both always show the same content.
 *
 * Structure: exactly one airport-utility bullet, then 2–3 destination bullets.
 * When places data is available, bullets reflect actual nearby results.
 * Falls back to static airport fields when places are not yet loaded.
 */
export function getWhyFlyHere(airport: any, places?: NearbyPlaces): string[] {
  const bullets: string[] = [];
  const hasTower = airport.has_tower === 'ATCT';
  const hasFuel  = !!airport.fuel;
  const rl = maxRunwayLength(airport);

  // ── 1. One airport-utility bullet (always first) ─────────────────────────
  if (hasTower && hasFuel) {
    bullets.push('Towered field with fuel on the ramp — smooth stop on any cross-country');
  } else if (hasFuel && rl >= 5000) {
    bullets.push(`${rl.toLocaleString()} ft runway with fuel — handles most GA aircraft with ease`);
  } else if (hasFuel) {
    bullets.push('Fuel on the field makes this a convenient cross-country waypoint');
  } else if (hasTower) {
    bullets.push('Controlled field with an easy, predictable pattern');
  } else if (rl >= 5000) {
    bullets.push(`Long ${rl.toLocaleString()} ft runway and a welcoming, uncrowded pattern`);
  } else {
    bullets.push('Friendly GA airport with a laid-back atmosphere');
  }

  // ── 2a. Destination bullets from live nearby places data ─────────────────
  if (places) {
    const topRest  = bestPlace(places.restaurants);
    const topGolf  = bestPlace(places.golf);
    const topHotel = bestPlace(places.hotels);
    const topThing = bestPlace(places.things);

    if (topRest && bullets.length < 4) {
      const rating = parseFloat(topRest.rating) || 0;
      const dist = topRest.distanceMiles as number;
      if (rating >= 4.5) {
        bullets.push(`${topRest.name} (${dist} mi) is one of the top-rated spots in the area — worth the trip`);
      } else if (rating >= 4.0) {
        bullets.push(`${topRest.name} is ${dist} mi from the ramp — well-reviewed local spot`);
      } else {
        bullets.push(`Food within ${Math.ceil(dist)} miles of the field`);
      }
    }

    if (topGolf && bullets.length < 4) {
      const dist = topGolf.distanceMiles as number;
      bullets.push(`${topGolf.name} is ${dist} mi out — fly in, play a round, fly home`);
    }

    if (topHotel && bullets.length < 4) {
      const dist = topHotel.distanceMiles as number;
      bullets.push(`Lodging within ${Math.ceil(dist)} mile${Math.ceil(dist) === 1 ? '' : 's'} — easy overnight or weekend stop`);
    }

    if (topThing && bullets.length < 4) {
      const dist = topThing.distanceMiles as number;
      bullets.push(`${topThing.name} is ${dist} mi away — good reason to make the trip`);
    }
  } else {
    // ── 2b. Destination bullets from static airport fields (fallback) ────────
    if (airport.restaurant) bullets.push('Worth the flight for the local food scene alone');
    if (airport.golf        && bullets.length < 4) bullets.push('Golf nearby — fly in, play a round, fly home');
    if (airport.hotel       && bullets.length < 4) bullets.push('Overnight options make this a great weekend getaway');
    if (airport.attraction  && bullets.length < 4) bullets.push('Local attractions worth exploring after you tie down');
    if (airport.courtesy_car && bullets.length < 4) bullets.push('Courtesy car puts the whole town within easy reach');
  }

  // ── 3. Fallback destination bullets if data is sparse ────────────────────
  const location = [airport.city, airport.state].filter(Boolean).join(', ');
  if (bullets.length < 2) {
    bullets.push(
      location
        ? `${location} is the destination — small town worth the flight`
        : 'Low-traffic field in an area worth exploring'
    );
  }
  if (bullets.length < 3) {
    bullets.push('Low-traffic field with a welcoming atmosphere');
  }

  return bullets.slice(0, 4);
}
