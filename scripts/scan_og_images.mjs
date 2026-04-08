// scan_og_images.mjs
// Scans og:image meta tags for all CURATED_EVENTS from gaEvents.ts

const EVENTS = [
  { id: 'ce-sunfun-2026', event_name: "Sun 'n Fun Aerospace Expo 2026", event_link: 'https://www.flysnf.org' },
  { id: 'ce-airventure-2026', event_name: 'EAA AirVenture Oshkosh 2026', event_link: 'https://www.eaa.org/airventure' },
  { id: 'ce-arlington-2026', event_name: 'Arlington Fly-In 2026', event_link: 'https://www.arlingtonflyin.org' },
  { id: 'ce-national-stearman-2026', event_name: 'National Stearman Fly-In 2026', event_link: 'https://www.nationalstearmanflyin.com' },
  { id: 'ce-aaa-blakesburg-2026', event_name: 'AAA/APM Antique Airplane Fly-In 2026', event_link: 'https://www.antiqueairfield.com' },
  { id: 'ce-aopa-homecoming-2026', event_name: 'AOPA Homecoming Fly-In 2026', event_link: 'https://www.aopa.org/community/events/aopa-fly-in' },
  { id: 'ce-aopa-carolina-2026', event_name: 'AOPA Fly-In — Carolinas 2026', event_link: 'https://www.aopa.org/community/events/aopa-fly-in' },
  { id: 'ce-wings-houston-2026', event_name: 'Wings Over Houston Airshow 2026', event_link: 'https://www.wingsoverhouston.com' },
  { id: 'ce-cal-capital-airshow-2026', event_name: 'California Capital Airshow 2026', event_link: 'https://www.californiacapitalairshow.com' },
  { id: 'ce-thunder-louisville-2026', event_name: 'Thunder Over Louisville 2026', event_link: 'https://www.thunderoverlouisville.org' },
  { id: 'ce-watsonville-2026', event_name: 'Watsonville Fly-In & Air Show 2026', event_link: 'https://www.watsonvilleflyin.org' },
  { id: 'ce-copperstate-2026', event_name: 'Copperstate Fly-In 2026', event_link: 'https://copperstateflyinaz.com' },
  { id: 'ce-zenith-open-hangar-2026', event_name: 'Zenith Aircraft Open Hangar Days 2026', event_link: 'https://www.zenithair.com/open-hangar-days' },
  { id: 'ce-iowa-eaa-state-2026', event_name: 'Iowa EAA State Fly-In 2026', event_link: 'https://www.eaa.org' },
  { id: 'ce-eaa-pancake-va-2026', event_name: 'EAA Chapter 186 Spring Pancake Breakfast', event_link: 'https://www.eaa.org/eaa/chapters' },
  { id: 'ce-eaa-young-eagles-tx-2026', event_name: 'EAA Chapter 145 Young Eagles Pancake Breakfast', event_link: 'https://www.eaa.org/eaa/chapters' },
  { id: 'ce-eaa-pancake-co-2026', event_name: 'EAA Chapter 301 Summer Fly-In Breakfast', event_link: 'https://www.eaa.org/eaa/chapters' },
  { id: 'ce-eaa-pancake-or-2026', event_name: 'EAA Chapter 105 Pancake Breakfast & Young Eagles', event_link: 'https://www.eaa.org/eaa/chapters' },
  { id: 'mo-hermann-wurstfest-2026', event_name: 'Hermann Wurstfest', event_link: 'https://www.hermannareachamber.com/hermann-wurstfest' },
  { id: 'mo-kickin-it-route-66-bbq-challenge-2026', event_name: 'Kickin It Route 66 BBQ Challenge', event_link: 'https://www.saintrobert.com/page/kickin-it-route-66-barbecue-challenge' },
  { id: 'mo-queeny-art-fair-2026', event_name: 'Queeny Art Fair', event_link: 'https://www.queenyartfair.org/' },
  { id: 'mo-gateway-blues-festival-2026', event_name: 'Gateway Blues Festival', event_link: 'https://www.chaifetzarena.com/events/detail/gateway-blues-festival-1' },
  { id: 'mo-st-louis-beer-fest-2026', event_name: 'St. Louis Beer Fest', event_link: 'https://www.stlouisbeerfest.com/' },
  { id: 'mo-big-muddy-folk-festival-2026', event_name: 'Big Muddy Folk Festival', event_link: 'https://bigmuddy.org/big/2026/index.html' },
  { id: 'mo-camdenton-dogwood-festival-2026', event_name: 'Camdenton Dogwood Festival', event_link: 'https://camdentonchamber.com/dogwood-festival/' },
  { id: 'mo-missouri-cherry-blossom-festival-2026', event_name: 'Missouri Cherry Blossom Festival', event_link: 'https://www.cherryblossomfest.com/WordPress/' },
  { id: 'mo-branson-music-festival-2026', event_name: 'Branson Music Festival', event_link: 'https://bransonticket.com/branson-events/branson-music-festival/' },
  { id: 'mo-washmo-bbq-and-bluestfest-2026', event_name: 'WashMo BBQ and Bluestfest', event_link: 'https://www.facebook.com/events/934253365836870/' },
  { id: 'mo-the-flower-festival-at-baker-creek-2026', event_name: 'The Flower Festival at Baker Creek', event_link: 'https://www.rareseeds.com/flower-festival' },
  { id: 'mo-parkville-microbrew-festival-2026', event_name: 'Parkville Microbrew Festival', event_link: 'https://parkvillemicrobrewfest.com' },
  { id: 'mo-birds-bees-and-blooms-festival-2026', event_name: 'Birds Bees and Blooms Festival', event_link: 'https://www.allaboutbirds.org/news/event/arrow-rock-birds-bees-blooms-festival/' },
  { id: 'mo-central-missouri-renaissance-festival-2026', event_name: 'Central Missouri Renaissance Festival', event_link: 'https://www.centralmorenfest.net/' },
  { id: 'mo-unbound-book-festival-2026', event_name: 'Unbound Book Festival', event_link: 'https://www.unboundbookfestival.com/' },
  { id: 'mo-dogwood-azalea-festival-2026', event_name: 'Dogwood-Azalea Festival', event_link: 'https://dogwoodazaleafestival.org/' },
  { id: 'mo-emmett-kelly-clown-festival-2026', event_name: 'Emmett Kelly Clown Festival', event_link: 'https://www.downtownhoustonmo.org/' },
  { id: 'mo-branson-elvis-festival-2026', event_name: 'Branson Elvis Festival', event_link: 'http://www.bransonelvisfestival.com/' },
  { id: 'mo-brookside-art-annual-2026', event_name: 'Brookside Art Annual', event_link: 'https://brooksideartannual.com/' },
  { id: 'mo-apple-blossom-festival-2026', event_name: 'Apple Blossom Festival', event_link: 'https://appleblossomparade.com/' },
  { id: 'mo-springfield-artsfest-2026', event_name: 'Springfield Artsfest', event_link: 'https://www.springfieldarts.org/artsfest/' },
  { id: 'mo-weston-winefest-2026', event_name: 'Weston Winefest', event_link: 'https://www.westonmo.com/calendar-events' },
  { id: 'mo-st-james-sip-n-savor-2026', event_name: 'St. James Sip N Savor', event_link: 'https://visitstjamesmo.com/sip-n-savor/' },
  { id: 'mo-midwest-maifest-2026', event_name: 'Midwest Maifest', event_link: 'https://midwestmaifest.org/' },
  { id: 'mo-perryville-mayfest-2026', event_name: 'Perryville Mayfest', event_link: 'https://visitperrycounty.com/event/mayfest-perryville-mo-2026/' },
  { id: 'mo-mushroom-festival-2026', event_name: 'Mushroom Festival', event_link: 'https://www.mushroomfestival.net/' },
  { id: 'mo-maifest-hermann-2026', event_name: 'Maifest Hermann', event_link: 'https://maifesthermann.org/' },
  { id: 'mo-scott-joplin-international-ragtime-festival-2026', event_name: 'Scott Joplin International Ragtime Festival', event_link: 'https://www.scottjoplin.org/' },
  { id: 'mo-st-louis-county-greek-festival-2026', event_name: 'St. Louis County Greek Festival', event_link: 'https://stlgreekfest.com/' },
  { id: 'mo-back-forty-bluegrass-festival-2026', event_name: 'Back Forty Bluegrass Festival', event_link: 'https://backfortybluegrasspark.com/' },
  { id: 'mo-twain-on-main-2026', event_name: 'Twain on Main', event_link: 'https://visithannibal.com/events/twain-on-main-festival/' },
  { id: 'mo-brookside-arts-annual-2026', event_name: 'Brookside Arts Annual', event_link: 'https://brooksideartannual.com/' },
  { id: 'mo-morels-and-microbrews-2026', event_name: 'Morels and Microbrews', event_link: 'https://www.thebrickdistrict.com/morels-microbrews' },
  { id: 'mo-weston-roots-music-festival-2026', event_name: 'Weston Roots Music Festival', event_link: 'https://www.westonmo.com/calendar-events' },
  { id: 'mo-silver-sage-renaissance-festival-2026', event_name: 'Silver Sage Renaissance Festival', event_link: 'https://www.facebook.com/SilverSageRenFest/' },
  { id: 'mo-st-louis-african-arts-festival-2026', event_name: 'St. Louis African Arts Festival', event_link: 'https://stlafricanartsfest.com/' },
  { id: 'mo-missouri-river-irish-festival-2026', event_name: 'Missouri River Irish Festival', event_link: 'https://mrifsc.com/' },
  { id: 'mo-lebanon-route-66-festival-2026', event_name: 'Lebanon Route 66 Festival', event_link: 'http://www.lebanonroute66.com/festival/' },
  { id: 'mo-route-66-summerfest-2026', event_name: 'Route 66 Summerfest', event_link: 'https://route66summerfest.com/' },
  { id: 'mo-moberly-railroad-days-festival-2026', event_name: 'Moberly Railroad Days Festival', event_link: 'https://moberly.com/railroaddays/' },
  { id: 'mo-augusta-wine-and-jazz-festival-2026', event_name: 'Augusta Wine and Jazz Festival', event_link: 'https://www.theharmonie.org/jazzfest' },
  { id: 'mo-kimmswick-strawberry-festival-2026', event_name: 'Kimmswick Strawberry Festival', event_link: 'https://gokimmswick.com/events/strawberry-festival/' },
  { id: 'mo-farmington-country-days-2026', event_name: 'Farmington Country Days', event_link: 'https://farmingtoncountrydays.com' },
  { id: 'mo-webster-arts-fair-2026', event_name: 'Webster Arts Fair', event_link: 'https://www.websterartsfair.com/' },
  { id: 'mo-art-in-the-park-2026', event_name: 'Art in the Park', event_link: 'https://columbiaartleague.org/artinthepark/festival-information' },
  { id: 'mo-sliced-bread-day-2026', event_name: 'Sliced Bread Day', event_link: 'https://www.thehomeofslicedbread.com/sliced-bread-day' },
  { id: 'mo-excelsior-springs-wine-festival-2026', event_name: 'Excelsior Springs Wine Festival', event_link: 'https://visitexcelsior.com/wine-festival/' },
  { id: 'mo-arts-in-the-park-2026', event_name: 'Arts in the Park', event_link: 'https://www.artsinthepark.org/' },
  { id: 'mo-fulton-street-fair-2026', event_name: 'Fulton Street Fair', event_link: 'https://www.facebook.com/FultonStreetFair/' },
  { id: 'mo-salisbury-steak-festival-2026', event_name: 'Salisbury Steak Festival', event_link: 'https://www.facebook.com/salisburysteakfestival/' },
  { id: 'mo-bourbon-bbq-festival-2026', event_name: 'Bourbon BBQ Festival', event_link: 'https://www.facebook.com/BourbonBBQFestival/' },
  { id: 'mo-kansas-city-pride-2026', event_name: 'Kansas City Pride', event_link: 'https://www.facebook.com/KCPrideAlliance/' },
  { id: 'mo-tacos-and-tequila-festival-2026', event_name: 'Tacos and Tequila Festival', event_link: 'https://tacosandtequilafestival.com/market/kansas-city/' },
  { id: 'mo-sugar-creek-slavic-festival-2026', event_name: 'Sugar Creek Slavic Festival', event_link: 'https://www.slavicfest.com/' },
  { id: 'mo-downtown-days-2026', event_name: 'Downtown Days', event_link: 'https://www.leessummitdowntowndays.com/' },
  { id: 'mo-hoba-spring-bluegrass-festival-2026', event_name: 'HOBA Spring Bluegrass Festival', event_link: 'https://www.facebook.com/bluegrass.hoba/' },
  { id: 'mo-tom-sawyer-days-2026', event_name: 'Tom Sawyer Days', event_link: 'https://www.facebook.com/events/1185388583222351/' },
  { id: 'mo-st-charles-riverfest-2026', event_name: 'St. Charles Riverfest', event_link: 'https://www.stcharlescitymo.gov/1037/Riverfest' },
  { id: 'mo-starvy-creek-bluegrass-festival-july-2026', event_name: 'Starvy Creek Bluegrass Festival July', event_link: 'https://starvycreek.com/' },
  { id: 'mo-riverfest-cape-girardeau-2026', event_name: 'Riverfest Cape Girardeau', event_link: 'https://riverfestcape.com' },
  { id: 'mo-lake-of-the-ozarks-balloon-fest-2026', event_name: 'Lake of the Ozarks Balloon Fest', event_link: 'https://funlake.com/aquapalooza' },
  { id: 'mo-nemo-fair-2026', event_name: 'NEMO Fair', event_link: 'https://www.facebook.com/NEMOFAIR/' },
  { id: 'mo-missouri-bourbon-festival-2026', event_name: 'Missouri Bourbon Festival', event_link: 'https://missouribourbonfestival.com/' },
  { id: 'mo-excelsior-springs-bbq-and-fly-in-2026', event_name: 'Excelsior Springs BBQ and Fly-In', event_link: 'https://visitexcelsior.com/bbq-fly-in-on-the-river/' },
  { id: 'mo-blues-at-the-arch-festival-2026', event_name: 'Blues at the Arch Festival', event_link: 'https://www.archpark.org/events/blues-at-the-arch-2024' },
  { id: 'mo-festival-of-the-little-hills-2026', event_name: 'Festival of the Little Hills', event_link: 'https://www.festivalofthelittlehills.com/' },
  { id: 'mo-jomo-rt66-balloon-and-kite-festival-2026', event_name: 'JOMO-RT66 Balloon and Kite Festival', event_link: 'https://www.facebook.com/profile.php?id=61556098289138' },
  { id: 'mo-taste-of-st-louis-2026', event_name: 'Taste of St. Louis', event_link: 'https://www.thetastestl.com/' },
  { id: 'mo-gateway-dragon-boat-festival-2026', event_name: 'Gateway Dragon Boat Festival', event_link: 'https://gatewaydragonboat.com/' },
  { id: 'mo-norborne-soybean-festival-2026', event_name: 'Norborne Soybean Festival', event_link: 'https://www.facebook.com/NorborneSoybeanFestival' },
  { id: 'mo-birthplace-of-route-66-festival-2026', event_name: 'Birthplace of Route 66 Festival', event_link: 'https://www.route66festivalsgf.com/' },
  { id: 'mo-scott-joplin-ragtime-festival-2026', event_name: 'Scott Joplin Ragtime Festival', event_link: 'https://www.scottjoplin.org/' },
  { id: 'mo-lake-of-the-ozarks-bikefest-2026', event_name: 'Lake of the Ozarks Bikefest', event_link: 'https://lakebikefest.com/' },
  { id: 'mo-highlonesome-music-festival-2026', event_name: 'Highlonesome Music Festival', event_link: 'https://www.zeffy.com/en-US/ticketing/2026-highlonesome-music-festival' },
  { id: 'mo-kansas-city-irish-fest-2026', event_name: 'Kansas City Irish Fest', event_link: 'https://www.kcirishfest.com/' },
  { id: 'mo-big-river-steampunk-festival-2026', event_name: 'Big River Steampunk Festival', event_link: 'https://bigriversteampunkfestival.com/' },
  { id: 'mo-santacaligon-2026', event_name: 'SantaCaliGon', event_link: 'https://www.santacaligon.com/' },
  { id: 'mo-seymour-apple-festival-2026', event_name: 'Seymour Apple Festival', event_link: 'https://seymourapplefestival.com/' },
  { id: 'mo-st-james-grape-and-fall-festival-2026', event_name: 'St. James Grape and Fall Festival', event_link: 'https://visitstjamesmo.com/grape-fall-festival/' },
  { id: 'mo-harvest-festival-at-silver-dollar-city-2026', event_name: 'Harvest Festival at Silver Dollar City', event_link: 'https://www.silverdollarcity.com/theme-park/festivals/harvest-festival' },
  { id: 'mo-hermann-wine-and-jazz-festival-2026', event_name: 'Hermann Wine and Jazz Festival', event_link: 'https://www.classy.org/event/hermann-wine-and-jazz-festival-2025/e660954' },
  { id: 'mo-mosaics-fine-art-festival-2026', event_name: 'Mosaics Fine Art Festival', event_link: 'https://stcharlesmosaics.org/' },
  { id: 'mo-hootin-an-hollarin-2026', event_name: 'Hootin an Hollarin', event_link: 'https://hootinanhollarin.com/' },
  { id: 'mo-kirksville-whiskey-and-turkey-festival-2026', event_name: 'Kirksville Whiskey and Turkey Festival', event_link: 'https://www.facebook.com/downtownkirksville' },
  { id: 'mo-clark-county-mule-festival-2026', event_name: 'Clark County Mule Festival', event_link: 'http://www.clarkcountymulefestival.com/' },
  { id: 'mo-the-great-forest-park-balloon-race-2026', event_name: 'The Great Forest Park Balloon Race', event_link: 'https://greatforestparkballoonrace.com/' },
  { id: 'mo-heartsburg-pumpkin-festival-2026', event_name: 'Heartsburg Pumpkin Festival', event_link: 'https://www.hartsburgpumpkinfest.com/' },
  { id: 'mo-arrow-rock-heritage-festival-2026', event_name: 'Arrow Rock Heritage Festival', event_link: 'https://arrowrock.org/events/58th-annual-heritage-festival/' },
  { id: 'mo-plaza-art-fair-2026', event_name: 'Plaza Art Fair', event_link: 'https://www.plazaartfair.com/' },
  { id: 'mo-saint-charles-oktoberfest-2026', event_name: 'Saint Charles Oktoberfest', event_link: 'https://www.facebook.com/SaintCharlesOktoberfest/' },
  { id: 'mo-concordia-fall-festival-2026', event_name: 'Concordia Fall Festival', event_link: 'http://www.concordiafallfestival.com' },
  { id: 'mo-harvest-hootenanny-2026', event_name: 'Harvest Hootenanny', event_link: 'https://www.facebook.com/hannibalhoot/' },
  { id: 'mo-blue-springs-fall-fun-festival-2026', event_name: 'Blue Springs Fall Fun Festival', event_link: 'https://www.bluespringsfallfestival.com/' },
  { id: 'mo-starvy-creek-bluegrass-festival-september-2026', event_name: 'Starvy Creek Bluegrass Festival September', event_link: 'https://starvycreek.com/' },
  { id: 'mo-liberty-fall-festival-2026', event_name: 'Liberty Fall Festival', event_link: 'https://libertyfallfest.com/' },
  { id: 'mo-wilder-days-festival-2026', event_name: 'Wilder Days Festival', event_link: 'https://www.facebook.com/WilderDaysMansfieldMO/' },
  { id: 'mo-japanese-fall-festival-2026', event_name: 'Japanese Fall Festival', event_link: 'https://peacethroughpeople.org/events/japanese-fall-festival/' },
  { id: 'mo-mo-jazz-music-festival-2026', event_name: 'Mo Jazz Music Festival', event_link: 'https://mojazz.net/' },
  { id: 'mo-black-walnut-festival-2026', event_name: 'Black Walnut Festival', event_link: 'https://www.facebook.com/theblackwalnutfestival/' },
  { id: 'mo-old-drum-day-2026', event_name: 'Old Drum Day', event_link: 'https://www.facebook.com/jocomohistory' },
  { id: 'mo-farmington-blues-brews-and-bbq-2026', event_name: 'Farmington Blues Brews and BBQ', event_link: 'https://www.facebook.com/profile.php?id=100057619931002' },
  { id: 'mo-moroots-music-festival-2026', event_name: 'MoRoots Music Festival', event_link: 'https://www.facebook.com/MORootsMusicFestival/' },
  { id: 'mo-cotton-carnival-2026', event_name: 'Cotton Carnival', event_link: 'https://business.sikeston.net/events/details/american-legion-cotton-carnival-15584' },
  { id: 'mo-ozarks-bacon-fest-2026', event_name: 'Ozarks Bacon Fest', event_link: 'https://www.ozarkempirefair.com/p/events/ozark-empire-fairgrounds-produced-events/ozarks-bacon-fest2' },
  { id: 'mo-hermann-oktoberfest-2026', event_name: 'Hermann Oktoberfest', event_link: 'https://visithermann.com' },
  { id: 'mo-apple-butter-makin-days-2026', event_name: 'Apple Butter Makin Days', event_link: 'https://www.mtvchamber.com/apple-butter-makin-days.html' },
  { id: 'mo-versailles-olde-tyme-apple-festival-2026', event_name: 'Versailles Olde Tyme Apple Festival', event_link: 'https://www.facebook.com/versaillesoldetymeapplefestival/' },
  { id: 'mo-weston-applefest-2026', event_name: 'Weston AppleFest', event_link: 'https://www.westonmo.com/calendar-events' },
  { id: 'mo-historic-shaw-art-fair-2026', event_name: 'Historic Shaw Art Fair', event_link: 'https://shawstlouis.org/attractions-amenities/historic-shaw-art-fair/' },
  { id: 'mo-cackle-hatcherys-chicken-festival-2026', event_name: 'Cackle Hatcherys Chicken Festival', event_link: 'https://www.cacklehatchery.com/annual-chicken-festival/' },
  { id: 'mo-republic-pumpkin-daze-2026', event_name: 'Republic Pumpkin Daze', event_link: 'https://www.republicpumpkindaze.com/' },
  { id: 'mo-augusta-bottoms-bier-festival-2026', event_name: 'Augusta Bottoms Bier Festival', event_link: 'https://augusta-chamber.org/event/augusta-bottoms-bier-festival-23rd-annual/' },
  { id: 'mo-uptown-jackson-oktoberfest-2026', event_name: 'Uptown Jackson Oktoberfest', event_link: 'https://www.ujro.org/oktoberfest' },
  { id: 'mo-old-miners-day-2026', event_name: 'Old Miners Day', event_link: 'https://www.oldminersdays.com/' },
  { id: 'mo-fest-of-ale-at-missouri-botanical-garden-2026', event_name: 'Fest of Ale at Missouri Botanical Garden', event_link: 'https://www.missouribotanicalgarden.org/fest-of-ale-3000' },
  { id: 'mo-best-of-missouri-market-2026', event_name: 'Best of Missouri Market', event_link: 'https://www.missouribotanicalgarden.org/best-of-missouri-market-1570' },
  { id: 'mo-brew-at-the-zoo-2026', event_name: 'Brew at the Zoo', event_link: 'https://kansascityzoo.org/event/brew-at-the-zoo' },
  { id: 'mo-hoba-fall-bluegrass-festival-2026', event_name: 'HOBA Fall Bluegrass Festival', event_link: 'https://www.facebook.com/bluegrass.hoba/' },
  { id: 'mo-biscuits-beats-brews-2026', event_name: 'Biscuits Beats Brews', event_link: 'https://www.biscuitsbeatsbrews.com/' },
  { id: 'mo-soulard-oktoberfest-2026', event_name: 'Soulard Oktoberfest', event_link: 'https://soulard-oktoberfest.com/' },
  { id: 'mo-burg-fest-street-fair-2026', event_name: 'Burg Fest Street Fair', event_link: 'https://warrensburgmainstreet.org/burg-fest/' },
];

const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const TIMEOUT_MS = 10000;

/**
 * Fetch HTML at a URL with a timeout, following up to 5 redirects.
 * Returns the HTML string or throws on error/timeout.
 */
async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract the og:image content from HTML.
 * Handles both attribute orderings:
 *   <meta property="og:image" content="...">
 *   <meta content="..." property="og:image">
 */
function extractOgImage(html) {
  // property first, then content
  const m1 = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (m1) return m1[1].trim();

  // content first, then property
  const m2 = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (m2) return m2[1].trim();

  return null;
}

async function main() {
  const COL_NAME = 45;
  const COL_LINK = 60;

  const lines = [];
  const log = (str) => {
    process.stdout.write(str + '\n');
    lines.push(str);
  };

  const header =
    'EVENT NAME'.padEnd(COL_NAME) + ' | ' +
    'EVENT LINK'.padEnd(COL_LINK) + ' | ' +
    'OG:IMAGE';
  const divider = '-'.repeat(COL_NAME) + '-+-' + '-'.repeat(COL_LINK) + '-+-' + '-'.repeat(80);

  log('');
  log('OG:IMAGE SCAN RESULTS');
  log('=====================');
  log(`Scanned: ${new Date().toISOString()}`);
  log(`Total events: ${EVENTS.length}`);
  log('');
  log(header);
  log(divider);

  let withImage = 0;
  let missing = 0;

  // Deduplicate URLs so we only fetch each unique URL once
  const cache = new Map();

  for (const event of EVENTS) {
    let ogImage;

    try {
      let html;
      if (cache.has(event.event_link)) {
        html = cache.get(event.event_link);
      } else {
        html = await fetchHtml(event.event_link);
        cache.set(event.event_link, html);
      }
      ogImage = extractOgImage(html);
    } catch (err) {
      ogImage = null;
    }

    const nameCol = event.event_name.length > COL_NAME
      ? event.event_name.slice(0, COL_NAME - 1) + '…'
      : event.event_name.padEnd(COL_NAME);

    const linkCol = event.event_link.length > COL_LINK
      ? event.event_link.slice(0, COL_LINK - 1) + '…'
      : event.event_link.padEnd(COL_LINK);

    const imageCol = ogImage ? ogImage : 'NONE';

    if (ogImage) {
      withImage++;
    } else {
      missing++;
    }

    log(`${nameCol} | ${linkCol} | ${imageCol}`);
  }

  log('');
  log(divider);
  log('');
  log('SUMMARY');
  log('-------');
  log(`Total events  : ${EVENTS.length}`);
  log(`Have og:image : ${withImage}`);
  log(`Missing       : ${missing}`);
  log('');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
