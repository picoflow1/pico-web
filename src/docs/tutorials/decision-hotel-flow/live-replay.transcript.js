const turns = [
  { stage: "Router → dates", user: "Hi", bot: "Please provide the check-in and checkout dates for your stay in Portland." },
  { stage: "Dates · correction", user: "February 30, 2027 through March 5, 2027", bot: "February 30, 2027, is not a valid date. Please provide a valid check-in date after the current date (July 15, 2027) and a valid checkout date after the check-in date." },
  { stage: "Dates → budget", user: "August 1 through August 8, 2027", bot: "Could you please share your budget for the hotel stay per night?" },
  { stage: "Budget · correction", user: "minimum 800 and maximum 500 per night", bot: "You mentioned a minimum budget that is higher than the maximum budget. Could you please clarify the correct range for your nightly hotel budget?" },
  { stage: "Budget → room type", user: "maximum 700 per night, with no minimum", bot: "Could you please tell me your preferred room type: `one bed`, `two beds`, or `suite`?" },
  { stage: "Room type → amenities", user: "a suite", bot: "Which hotel amenities do you require? For example, free WiFi, free parking, breakfast, a pool, or a fitness center." },
  { stage: "Cross-step date correction", user: "Actually change my dates to August 3 through August 9, 2027", bot: "Which hotel amenities do you require? For example, free WiFi, free parking, breakfast, a pool, or a fitness center." },
  { stage: "Amenities → distance", user: "free wifi and free parking", bot: "What is the maximum distance in miles you're willing to travel from Portland airport and Portland city center? If there's no limit, please let me know." },
  { stage: "Distance → review", user: "distance does not matter", bot: "Current Portland hotel criteria:\n- Dates: 2027-08-03 to 2027-08-09\n- Nightly budget: no minimum to $700\n- Room type: suite\n- Amenities: freeWiFi, freeParking\n- Distance: no preference\n\nTell me what to revise, or say “search” when ready." },
  { stage: "Criteria review", user: "show my criteria", bot: "Current Portland hotel criteria:\n- Dates: 2027-08-03 to 2027-08-09\n- Nightly budget: no minimum to $700\n- Room type: suite\n- Amenities: freeWiFi, freeParking\n- Distance: no preference\n\nTell me what to revise, or say “search” when ready." },
  { stage: "Readiness → search → presentation review", user: "search", bot: "Here are the available hotels with their total prices in U.S. currency:\n\n1. **Hampton Inn & Suites Portland Tigard** - Total: $3810.60\n2. **Hilton Garden Inn Portland Airport** - Total: $4204.80\n3. **Hilton Garden Inn Beaverton** - Total: $3350.70\n4. **Hampton Inn Sherwood Portland** - Total: $3547.80\n\nYou may book a hotel by its name or number, or revise your dates, budget, room type, amenities, or distance preferences. Please let me know how you'd like to proceed!" },
  { stage: "Present → budget revision", user: "change maximum budget to 500 per night", bot: "Current Portland hotel criteria:\n- Dates: 2027-08-03 to 2027-08-09\n- Nightly budget: no minimum to $500\n- Room type: suite\n- Amenities: freeWiFi, freeParking\n- Distance: no preference\n\nTell me what to revise, or say “search” when ready." },
  { stage: "Empty search → router", user: "search", bot: "No hotels matched all current criteria. Tell me whether to revise budget, room type, amenities, or distance." },
  { stage: "Budget revision → review", user: "change maximum budget to 750 per night", bot: "Current Portland hotel criteria:\n- Dates: 2027-08-03 to 2027-08-09\n- Nightly budget: no minimum to $750\n- Room type: suite\n- Amenities: freeWiFi, freeParking\n- Distance: no preference\n\nTell me what to revise, or say “search” when ready." },
  { stage: "Second reviewed presentation", user: "search", bot: "Here are the current matching hotels:\n\n1. **Hampton Inn & Suites Portland Tigard** - Total: $3,810.60\n2. **Hilton Garden Inn Portland Airport** - Total: $4,204.80\n3. **Hilton Garden Inn Beaverton** - Total: $3,350.70\n4. **Hampton Inn Sherwood Portland** - Total: $3,547.80\n\nYou may book a hotel by name or number, or you can revise the search criteria such as dates, budget, room type, amenities, or distance." },
  { stage: "Present → completed", user: "book hotel 1", bot: "Hampton Inn & Suites Portland Tigard is booked with confirmation #613373. Thank you for choosing Hilton.", completed: true },
];

export default {
  turns,
  decisionUsage: { calls: 22, inputTokens: 27778, outputTokens: 2442, totalTokens: 30220 },
  llmUsage: { inputTokens: 12269, outputTokens: 684, totalTokens: 12953 },
};
