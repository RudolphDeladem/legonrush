// "Not sure where to go?": turns what a student types ("I want beans", "I need to print") into places
// on the campus map. Each intent lists real map places (game/campusmap.ts names) with what you can do
// there. Kept to what each place plainly offers; anything not listed falls back to a name search.

export interface IntentHit {
  /** a place name on the campus map */
  place: string;
  /** what you can do there, shown under the result */
  tags: string;
}
export interface Intent {
  id: string;
  /** what the student asked for, in a few words ("Food", "Printing") */
  title: string;
  /** words that point to this intent */
  words: RegExp;
  hits: IntentHit[];
}

const FOOD_SPOTS: IntentHit[] = [
  { place: 'Night Market', tags: 'Food stalls · Local dishes · Open late' },
  { place: 'Central Cafeteria, CC', tags: 'Cafeteria · Meals between lectures' },
  { place: 'Bush Canteen (near Department of Music)', tags: 'Local food · Student prices' },
  { place: 'Pent Food Court', tags: 'Food court · Snacks and meals' },
  { place: 'Bush Canteen (near School of Public Health)', tags: 'Local food · Student prices' },
];

export const INTENTS: Intent[] = [
  { id: 'beans', title: 'Beans (gob3, red red)', words: /\b(beans?|gob[e3]|red ?red|yo ?k3 ?gari|gari)\b/, hits: [
    { place: 'Night Market', tags: 'Food stalls · Beans and gari, red red, plantain' },
    { place: 'Bush Canteen (near Department of Music)', tags: 'Local food · Beans dishes at student prices' },
    { place: 'Bush Canteen (near School of Public Health)', tags: 'Local food · Student prices' },
    { place: 'Central Cafeteria, CC', tags: 'Cafeteria · Local dishes' },
  ] },
  { id: 'jollof', title: 'Jollof', words: /\bjollof\b/, hits: [
    { place: 'Didi Jollof', tags: 'Jollof rice' },
    { place: 'Night Market', tags: 'Food stalls · Jollof, fried rice' },
    { place: 'Pent Food Court', tags: 'Food court · Rice dishes' },
  ] },
  { id: 'koko', title: 'Koko and breakfast', words: /\b(koko|porridge|hausa koko|breakfast|tea bread)\b/, hits: [
    { place: 'Koko Joint', tags: 'Koko · Breakfast' },
    { place: 'Night Market', tags: 'Food stalls · Breakfast and snacks' },
  ] },
  { id: 'fastfood', title: 'Chicken, pizza and kebab', words: /\b(pizza|chicken|kfc|kebab|khebab|burger|fries|shawarma)\b/, hits: [
    { place: 'Pizzaman-Chickenman', tags: 'Pizza · Fried chicken' },
    { place: 'KFC', tags: 'Fried chicken · Burgers' },
    { place: "Baba's Special Kebab", tags: 'Kebab' },
    { place: 'Night Market', tags: 'Food stalls · Shawarma and snacks' },
  ] },
  { id: 'food', title: 'Food', words: /\b(eat|food|hungry|chop|lunch|supper|dinner|waakye|kenkey|banku|fufu|indomie|fried rice|rice|kelewele|plantain|snacks?|restaurant|canteen)\b/, hits: FOOD_SPOTS },
  { id: 'drink', title: 'Somewhere to have a drink', words: /\b(drink|drinks|pub|bar|beer|juice)\b/, hits: [
    { place: 'Library Pub', tags: 'Pub · Drinks and food' },
    { place: 'Night Market', tags: 'Food stalls · Drinks' },
  ] },
  { id: 'print', title: 'Printing', words: /\b(print|printing|printer|photocop\w*|copies|binding|bind|scan|scanning|typing|laminat\w*)\b/, hits: [
    { place: 'Printing Shop', tags: 'Printing · Photocopying · Binding' },
    { place: 'The Balme Library', tags: 'Printing · Photocopying · Academic resources' },
    { place: 'Kingdom Books and Stationery', tags: 'Stationery · Printing' },
    { place: 'EPP Books', tags: 'Books · Stationery' },
  ] },
  { id: 'study', title: 'Somewhere to study', words: /\b(study|studying|read|reading|quiet|revise|revision|library|exam prep)\b/, hits: [
    { place: 'The Balme Library', tags: 'Main library · Quiet reading rooms · Wi-Fi' },
    { place: 'Balme Library extension', tags: 'Library space · Study areas' },
    { place: 'Commonwealth Hall Library', tags: 'Hall library · Quiet study' },
    { place: 'Hall Library', tags: 'Hall library · Quiet study' },
    { place: 'Science Resource Centre', tags: 'Study space · Science resources' },
  ] },
  { id: 'internet', title: 'Internet and computers', words: /\b(wi-?fi|internet|computer|computers|ict|data)\b/, hits: [
    { place: 'The Balme Library', tags: 'Wi-Fi · Computers' },
    { place: 'University of Ghana Computing Systems (UGCS)', tags: 'University IT services' },
    { place: 'Mensah Sarbah Hall ICT Centre', tags: 'Computers · Internet' },
  ] },
  { id: 'money', title: 'Cash and banks', words: /\b(money|cash|withdraw\w*|atm|bank|banks|deposit|account)\b/, hits: [
    { place: 'University of Ghana banking square', tags: 'Banks · ATMs · Mobile money vendors' },
    { place: 'Stanbic Bank', tags: 'Bank · ATM' },
    { place: 'Ecobank (near Night Market)', tags: 'Bank · ATM' },
    { place: 'GCB Bank (near SRC Union Building)', tags: 'Bank · ATM' },
    { place: 'Absa ATM', tags: 'ATM' },
  ] },
  { id: 'momo', title: 'Mobile money', words: /\b(momo|mobile money|airtime|credit|top ?up)\b/, hits: [
    { place: 'Mobile Money', tags: 'Mobile money · Cash in and out' },
    { place: 'University of Ghana banking square', tags: 'Mobile money vendors · ATMs' },
  ] },
  { id: 'forex', title: 'Changing money', words: /\b(forex|exchange|dollars?|euros?|pounds?)\b/, hits: [
    { place: 'Chambers Forex Bureau', tags: 'Forex bureau' },
    { place: 'Big J Forex Bureau', tags: 'Forex bureau' },
  ] },
  { id: 'fees', title: 'Paying fees', words: /\b(fees?|school fees|hall fees|pay)\b/, hits: [
    { place: 'University of Ghana banking square', tags: 'Banks that take school and hall fees' },
    { place: 'Cash office', tags: 'University cash office' },
  ] },
  { id: 'football', title: 'Football', words: /\b(football|soccer|ball|futsal|match)\b/, hits: [
    { place: 'Sarbah field', tags: 'Football pitch' },
    { place: 'Sports Complex', tags: 'Sports grounds · Inter-hall games' },
    { place: 'Athletic Oval', tags: 'Field and running track' },
  ] },
  { id: 'gym', title: 'Working out', words: /\b(gym|work ?out|exercise|fitness|weights|run|running|jog|jogging|keep fit|sports?)\b/, hits: [
    { place: 'UG Gymnasium', tags: 'Gym' },
    { place: 'Athletic Oval', tags: 'Running track · Morning and evening jogs' },
    { place: 'Matrix Fitness & Lifestyle Center', tags: 'Gym · Fitness classes' },
    { place: 'Sports Complex', tags: 'Sports grounds' },
  ] },
  { id: 'health', title: 'Seeing a doctor', words: /\b(sick|ill|doctor|hospital|clinic|fever|malaria|hurt|injur\w*|nurse|medical)\b/, hits: [
    { place: 'University of Ghana Hospital', tags: 'University hospital · Students and staff' },
    { place: 'University of Ghana Medical Center Limited', tags: 'Medical centre' },
  ] },
  { id: 'pharmacy', title: 'Pharmacy', words: /\b(pharmacy|chemist|medicine|drugs?|tablets?|paracetamol)\b/, hits: [
    { place: 'Ernest Chemist', tags: 'Pharmacy' },
    { place: 'Emporium Pharmacy', tags: 'Pharmacy' },
    { place: 'Elizabeth Sey Pharmacy', tags: 'Pharmacy' },
  ] },
  { id: 'complaint', title: 'Academic help and complaints', words: /\b(complain\w*|complaint|academic|transcript|registration|register|admission|result|results|grades?|records?|petition|appeal|student id|id card)\b/, hits: [
    { place: 'University of Ghana Registry', tags: 'Academic affairs · Records · Admissions' },
    { place: 'Office of The Dean of Students', tags: 'Student welfare · Complaints and support' },
    { place: 'Adminstration Block', tags: 'University administration' },
  ] },
  { id: 'counselling', title: 'Someone to talk to', words: /\b(counsel\w*|stress\w*|stressed|depress\w*|anxious|anxiety|career|advice|lonely)\b/, hits: [
    { place: 'Career and councelling dept', tags: 'Counselling · Career advice' },
    { place: 'Office of The Dean of Students', tags: 'Student welfare and support' },
  ] },
  { id: 'books', title: 'Books and stationery', words: /\b(books?|textbooks?|stationery|pens?|notebooks?|calculator)\b/, hits: [
    { place: 'University of Ghana Bookshop', tags: 'Textbooks · Stationery · UG items' },
    { place: 'EPP Books', tags: 'Books · Stationery' },
    { place: 'Kingdom Books and Stationery', tags: 'Books · Stationery' },
  ] },
  { id: 'post', title: 'Post and parcels', words: /\b(post|parcel|package|letter|courier|dhl|send)\b/, hits: [
    { place: 'Legon Post Office', tags: 'Letters · Parcels' },
    { place: 'DHL', tags: 'Courier' },
  ] },
  { id: 'police', title: 'Police', words: /\b(police|lost|stolen|theft|thief|report)\b/, hits: [
    { place: 'Legon Police Station', tags: 'Report a loss or theft · Police reports' },
  ] },
  { id: 'church', title: 'Church', words: /\b(church|mass|service|fellowship|chapel|pray|prayer|worship)\b/, hits: [
    { place: 'Legon Interdenominational Church', tags: 'Church services' },
    { place: 'St. Thomas Aquinas Catholic Church', tags: 'Catholic church' },
    { place: 'Commonwealth Hall Chapel', tags: 'Chapel' },
    { place: 'Anglican Church- Main Church', tags: 'Anglican church' },
  ] },
  { id: 'mosque', title: 'Mosque', words: /\b(mosque|jumu?ah|salat|muslim)\b/, hits: [
    { place: 'Mensah Sarbah Hall Mosque', tags: 'Mosque' },
    { place: 'Muslim Prayer Lounge', tags: 'Prayer space' },
  ] },
  { id: 'transport', title: 'Getting off campus', words: /\b(trotro|taxi|uber|bolt|bus|car|go home|leave campus|town|madina|accra|circle)\b/, hits: [
    { place: 'Legon Taxi Rank', tags: 'Taxis' },
    { place: 'Legon Main Entrance', tags: 'Main gate · Trotros and taxis nearby' },
    { place: 'Okponglo', tags: 'Trotros towards East Legon, Madina and town' },
    { place: 'Legon Hospital Bus Station', tags: 'Bus stop' },
  ] },
  { id: 'repair', title: 'Phone and laptop repairs', words: /\b(repair|fix|broken|screen|charger|laptop|phone)\b/, hits: [
    { place: 'Laptop repairs and mobile shop infront of SRC', tags: 'Laptop and phone repairs · Accessories' },
    { place: 'Samsung shop', tags: 'Phones · Accessories' },
  ] },
  { id: 'laundry', title: 'Laundry', words: /\b(laundry|wash|washing|clothes|iron)\b/, hits: [
    { place: 'Laundry Hub', tags: 'Laundry' },
    { place: 'Rapidwash Laundry', tags: 'Laundry' },
  ] },
  { id: 'barber', title: 'Haircut', words: /\b(haircut|barber|hair|salon|nails?)\b/, hits: [
    { place: 'Silver Hair Barber Shop', tags: 'Barber' },
    { place: 'Nailcanta', tags: 'Nails' },
  ] },
  { id: 'shop', title: 'Shopping', words: /\b(shop|shopping|mall|groceries|grocery|supermarket|provisions|toiletries|buy)\b/, hits: [
    { place: 'Legon City Mall', tags: 'Mall · Groceries · Eating out' },
    { place: 'Night Market', tags: 'Provisions · Toiletries · Snacks' },
    { place: 'Max Mart', tags: 'Supermarket' },
    { place: 'Benzola Supermarket and Mini Restaurant', tags: 'Supermarket' },
  ] },
  { id: 'chill', title: 'Somewhere to relax', words: /\b(relax|chill|hang ?out|date|picnic|walk|fresh air|nature|sunset|view)\b/, hits: [
    { place: 'University of Ghana Botanical Gardens', tags: 'Gardens · Picnics · Canopy walk' },
    { place: 'Balme Library Fountain', tags: 'Lawns · Meeting point · Photos' },
    { place: 'Night Market', tags: 'Food and friends till late' },
    { place: 'Great Hall', tags: 'Up on Legon Hill · Views across campus' },
  ] },
  { id: 'photos', title: 'Photos', words: /\b(photos?|pictures?|pics?|selfie|graduation|congregation)\b/, hits: [
    { place: 'Balme Library Fountain', tags: 'The classic Legon photo spot' },
    { place: 'Great Hall', tags: 'Congregation · Views' },
    { place: 'University of Ghana Botanical Gardens', tags: 'Gardens' },
  ] },
  { id: 'src', title: 'Student union and clubs', words: /\b(src|union|clubs?|societ(y|ies)|student government|nugs)\b/, hits: [
    { place: 'SRC Union Building', tags: 'SRC offices · Clubs · Student events' },
  ] },
  { id: 'halls', title: 'Halls of residence', words: /\b(my hall|halls|hostels?|residence|where i (stay|live|sleep))\b/, hits: [
    { place: 'Legon Hall', tags: 'Hall · The first hall on campus' },
    { place: 'Akuafo Hall Main', tags: 'Hall · One of the five traditional halls' },
    { place: 'Commonwealth Hall', tags: 'Hall · Vandals, all-male' },
    { place: 'Volta Hall', tags: 'Hall · All-female' },
    { place: 'Mensah Sarbah Hall', tags: 'Hall · Vikings' },
    { place: 'Dr. Hilla Limann Hall', tags: 'Hall · Diaspora halls' },
    { place: 'Jubilee Hall', tags: 'Hall' },
  ] },
  { id: 'lecture', title: 'Lecture halls', words: /\b(lecture|lectures|class|classes|tutorial|exam|exams|hall for lectures)\b/, hits: [
    { place: 'Jones Quartey Building, JQB', tags: 'Lecture block · Exams' },
    { place: 'New N Block, NNB', tags: 'Lecture block' },
    { place: 'N Block', tags: 'Lecture block' },
    { place: 'GCB Lecture Building', tags: 'Lecture building' },
  ] },
];

/** the quick examples under the search box */
export const INTENT_EXAMPLES = ['I want beans', 'I want to print', 'I need somewhere to study', 'I want to withdraw money', 'I want to play football', 'I want to see the Great Hall'];

/** the intents a request points to, best first (several when the request mixes things) */
export function matchIntents(text: string): Intent[] {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}' -]/gu, ' ')} `;
  return INTENTS.filter((i) => i.words.test(t));
}

/** what's left of a request once "I want to see / take me to / where is" is removed: a place name to search for */
export const placeQuery = (text: string) =>
  text.toLowerCase()
    .replace(/\b(i|we)\s+(want|need|would like|wanna)\s+(to\s+)?(go\s+to|see|visit|find|get\s+to|reach)?\b/g, ' ')
    .replace(/\b(take me to|show me|where is|where's|how do i get to|directions to|go to|the way to|find)\b/g, ' ')
    .replace(/\b(the|a|an|some|please|pls|abeg)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
