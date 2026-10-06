// The Explore guide: what the slow guided ride says when it stops at a place.
// `place` is the name on the campus map (game/campusmap.ts). Kept modest and checkable:
// what the place is and what students go there for, no made-up dates or numbers.

export interface GuideEntry {
  place: string;
  title: string;
  /** one or two sentences: what this place is */
  intro: string;
  /** what students do here */
  doHere: string[];
}

export const GUIDE: GuideEntry[] = [
  { place: 'Night Market', title: 'Night Market', intro: "Legon's busiest food spot: rows of stalls between the Diaspora halls and Banking Square that stay busy late into the night.", doHere: ['Buy supper after evening lectures: jollof, waakye, fried rice, indomie, kelewele and more', 'Pick up provisions, toiletries and snacks for the hall', 'Hang out with friends when campus gets quiet'] },
  { place: 'University of Ghana banking square', title: 'Banking Square', intro: 'A square of bank branches and ATMs right beside the Night Market, with Stanbic, CalBank, Prudential, Ecobank, Access Bank and others side by side.', doHere: ['Withdraw cash at the ATMs', 'Pay school fees and hall fees at the bank', 'Open a student account or sort out a card problem', 'Use the mobile money vendors around the square'] },
  { place: 'Central Cafeteria, CC', title: 'Central Cafeteria (CC)', intro: 'A central place to eat in the middle of the halls. Everybody just calls it CC.', doHere: ['Grab a quick meal between lectures', 'Meet friends and course mates', 'Sit and chat before heading to the library'] },
  { place: 'Jones Quartey Building, JQB', title: 'Jones Quartey Building (JQB)', intro: 'One of the busiest lecture blocks on campus, used by many departments. Most students call it JQB.', doHere: ['Attend lectures and tutorials', 'Write mid-semester and end of semester exams', 'Find an empty room for group study'] },
  { place: 'The Balme Library', title: 'Balme Library', intro: "The university's main library, named after David Balme, the first Principal of the University College of the Gold Coast.", doHere: ['Study in quiet reading rooms, especially in exam season', 'Borrow books and use the e-resources', 'Use the Wi-Fi and computers for assignments'] },
  { place: 'Balme Library Fountain', title: 'Balme Library Fountain', intro: 'The fountain and lawns in front of the Balme Library, one of the most photographed spots at Legon.', doHere: ['Meet up with friends ("meet me at the fountain")', 'Take photos, especially on graduation day', 'Rest on the lawns between classes'] },
  { place: 'University of Ghana Bookshop', title: 'University Bookshop', intro: 'The campus bookshop near the Balme Library.', doHere: ['Buy textbooks and course books', 'Get stationery, notebooks and exam supplies', 'Pick up University of Ghana branded items'] },
  { place: 'Legon Post Office', title: 'Legon Post Office', intro: 'The post office on campus, close to the Balme Library.', doHere: ['Send and receive letters and parcels', 'Collect packages sent from home'] },
  { place: 'University of Ghana Business School', title: 'Business School (UGBS)', intro: 'Home of the accounting, finance, marketing and management programmes.', doHere: ['Attend business lectures and seminars', 'Join business clubs and career talks'] },
  { place: 'University of Ghana Registry', title: 'Registry', intro: 'The main administration building. Admissions, records and most student paperwork are handled here.', doHere: ['Sort out admission and registration problems', 'Request transcripts and letters', 'Ask about student records'] },
  { place: 'Great Hall', title: 'Great Hall', intro: "The university's biggest hall, up on Legon Hill, with a view across campus.", doHere: ['Attend big ceremonies like matriculation and congregation (graduation)', 'Go to major university events, lectures and concerts'] },
  { place: 'Commonwealth Hall', title: 'Commonwealth Hall', intro: 'An all-male hall on Legon Hill. Its residents are known as Vandals and the hall motto is "Truth Stands".', doHere: ['Live in the hall', 'Join hall week and inter-hall sport', 'Watch the Vandals cheer on their hall'] },
  { place: 'Legon Hall', title: 'Legon Hall', intro: 'The first hall of residence built on the Legon campus, close to the Balme Library.', doHere: ['Live in the main hall or its annexes', 'Join hall week, hall sport and hall meetings'] },
  { place: 'Akuafo Hall Main', title: 'Akuafo Hall', intro: 'One of the five traditional halls. Akuafo is the Akan word for farmers.', doHere: ['Live in the hall or its annexes', 'Join hall week and inter-hall games'] },
  { place: 'Volta Hall', title: 'Volta Hall', intro: 'An all-female hall and one of the five traditional halls on campus.', doHere: ['Live in the hall', 'Join hall week and hall activities'] },
  { place: 'Mensah Sarbah Hall', title: 'Mensah Sarbah Hall', intro: 'Named after John Mensah Sarbah, a Gold Coast lawyer and nationalist. Its residents call themselves Vikings.', doHere: ['Live in the hall or its annexes', 'Eat at the Sarbah dining hall', 'Play on Sarbah field'] },
  { place: 'Athletic Oval', title: 'Athletic Oval', intro: 'The running track and field in the middle of the halls.', doHere: ['Jog or work out in the morning and evening', 'Train for inter-hall athletics', 'Play football with friends'] },
  { place: 'Sports Complex', title: 'Sports Complex', intro: "The university's main sports grounds.", doHere: ['Watch and play in inter-hall games', 'Train with the university sports teams', 'Keep fit'] },
  { place: 'University of Ghana Hospital', title: 'University Hospital', intro: 'The university hospital for students and staff. Most people call it Legon Hospital.', doHere: ['See a doctor when you are sick', 'Get medicine at the pharmacy', 'Do medical checks'] },
  { place: 'Legon Main Entrance', title: 'Main Gate', intro: 'The main road entrance to the campus. Trotros and taxis stop close by.', doHere: ['Catch a trotro or taxi off campus', 'Meet visitors coming to campus'] },
  { place: 'School of Law', title: 'School of Law', intro: "Home of the university's law programmes.", doHere: ['Attend law lectures', 'Take part in moot court and law society events'] },
  { place: 'School of Engineering Sciences', title: 'School of Engineering Sciences', intro: 'Home of the engineering programmes.', doHere: ['Attend lectures and labs', 'Work on engineering projects'] },
  { place: 'N Block', title: 'N Block', intro: 'A lecture block used by many departments.', doHere: ['Attend lectures and tutorials', 'Write exams'] },
  { place: 'New N Block, NNB', title: 'New N Block (NNB)', intro: 'The newer lecture block next to N Block. Students call it NNB.', doHere: ['Attend lectures and tutorials', 'Write exams'] },
  { place: 'Pent Food Court', title: 'Pent Food Court', intro: 'The food court at the Pentagon hostels (Pent).', doHere: ['Buy meals and snacks', 'Hang out with Pent residents'] },
  { place: 'Bush Canteen (near Department of Music)', title: 'Bush Canteen', intro: 'A popular, shady canteen near the Department of Music.', doHere: ['Eat local dishes at student prices', 'Take a break between lectures'] },
  { place: 'Dr. Hilla Limann Hall', title: 'Hilla Limann Hall', intro: "One of the four Diaspora halls, named after Dr. Hilla Limann, President of Ghana's Third Republic.", doHere: ['Live in the hall', 'Walk to the Night Market for food'] },
  { place: 'Alexander Kwapong Hall', title: 'Alexander Kwapong Hall', intro: 'One of the four Diaspora halls, named after Alexander Kwapong, the first Ghanaian Vice-Chancellor of the university.', doHere: ['Live in the hall', 'Join hall activities'] },
  { place: 'Elizabeth Frances Sey Hall', title: 'Elizabeth Frances Sey Hall', intro: 'One of the four Diaspora halls, named after Elizabeth Frances Sey, the first woman to graduate from the university.', doHere: ['Live in the hall', 'Join hall activities'] },
  { place: 'Jubilee Hall', title: 'Jubilee Hall', intro: 'A newer hall of residence near the Diaspora halls.', doHere: ['Live in the hall', 'Walk to the Night Market and Banking Square'] },
  { place: 'International Students Hostel 1, ISH 1', title: 'International Students Hostel (ISH)', intro: 'Hostels where many international and local students live.', doHere: ['Live in the hostel', 'Meet students from other countries'] },
  { place: 'Okponglo', title: 'Okponglo', intro: 'The busy junction on the east side of campus.', doHere: ['Catch a trotro towards East Legon, Madina or the city', 'Buy food and phone credit by the road'] },
  { place: 'Legon City Mall', title: 'Legon City Mall', intro: 'A shopping mall just off campus.', doHere: ['Buy groceries and things for your room', 'Eat out with friends'] },
  { place: 'University of Ghana Botanical Gardens', title: 'Botanical Gardens', intro: 'Large gardens of trees and plants on the south side of campus.', doHere: ['Walk, relax and have picnics', 'Try the canopy walkway with friends'] },
  { place: 'Legon Police Station', title: 'Legon Police Station', intro: 'The police station that serves the campus.', doHere: ['Report a lost phone, ID card or theft', 'Get a police report when you need one'] },
  { place: 'Commonwealth Hall Chapel', title: 'Commonwealth Hall Chapel', intro: 'The chapel beside Commonwealth Hall on Legon Hill.', doHere: ['Attend church services', 'Join choir and fellowship meetings'] },
  { place: 'Mensah Sarbah Hall Mosque', title: 'Sarbah Mosque', intro: 'The mosque at Mensah Sarbah Hall.', doHere: ['Pray', 'Meet with the Muslim student community'] },
];

const byPlace = new Map(GUIDE.map((g) => [g.place, g]));
export const guideFor = (place: string) => byPlace.get(place);
