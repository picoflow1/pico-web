export default {
  "turns": [
    {
      "stage": "date range prompt",
      "user": "Hi",
      "bot": "What are your Portland check-in and checkout dates?",
      "completed": false
    },
    {
      "stage": "invalid calendar date",
      "user": "February 30, 2027 through March 5, 2027",
      "bot": "February 30, 2027 is not a valid date. Could you please provide valid check-in and checkout dates for your stay in Portland?",
      "completed": false
    },
    {
      "stage": "valid date range",
      "user": "August 1 through August 8, 2027",
      "bot": "What nightly budget range should I use?",
      "completed": false
    },
    {
      "stage": "invalid inverted budget",
      "user": "minimum 800 and maximum 500 per night",
      "bot": "It seems like there's a contradiction in your budget range, as the minimum is higher than the maximum. Could you please clarify your intended budget range per night?",
      "completed": false
    },
    {
      "stage": "valid maximum budget",
      "user": "maximum 700 per night, with no minimum",
      "bot": "Would you like one bed, two beds, or a suite?",
      "completed": false
    },
    {
      "stage": "suite selection",
      "user": "a suite",
      "bot": "Which hotel amenities do you require?",
      "completed": false
    },
    {
      "stage": "cross-step date correction",
      "user": "Actually change my dates to August 3 through August 9, 2027",
      "bot": "Which hotel amenities do you require?",
      "completed": false
    },
    {
      "stage": "amenity selection",
      "user": "free wifi and free parking",
      "bot": "Do you have an airport or city-center distance limit?",
      "completed": false
    },
    {
      "stage": "no distance preference",
      "user": "distance does not matter",
      "bot": "Current Portland hotel criteria:\n- Dates: 2027-08-03 to 2027-08-09\n- Nightly budget: no minimum to $700\n- Room type: suite\n- Amenities: freeWiFi, freeParking\n- Distance: no preference\n\nTell me what to revise, or say “search” when ready.",
      "completed": false
    },
    {
      "stage": "criteria review",
      "user": "show my criteria",
      "bot": "Current Portland hotel criteria:\n- Dates: 2027-08-03 to 2027-08-09\n- Nightly budget: no minimum to $700\n- Room type: suite\n- Amenities: freeWiFi, freeParking\n- Distance: no preference\n\nTell me what to revise, or say “search” when ready.",
      "completed": false
    },
    {
      "stage": "first grounded hotel search",
      "user": "search",
      "bot": "1. **Hampton Inn & Suites Portland Tigard**  \n   - **Address:** 11799 SW 69th Ave, Tigard, OR 97223  \n   - **Nightly Price Range:** $522 - $600.3  \n   - **Total Price:** $3810.60\n\n2. **Hilton Garden Inn Portland Airport**  \n   - **Address:** 12048 NE Airport Way, Portland, OR 97220  \n   - **Nightly Price Range:** $576 - $662.4  \n   - **Total Price:** $4204.80\n\n3. **Hilton Garden Inn Beaverton**  \n   - **Address:** 15520 NW Gateway Ct, Beaverton, OR 97006  \n   - **Nightly Price Range:** $459 - $527.85  \n   - **Total Price:** $3350.70\n\n4. **Hampton Inn Sherwood Portland**  \n   - **Address:** 22000 SW Meinecke Parkway Sherwood, Oregon 97140 USA  \n   - **Nightly Price Range:** $486 - $558.9  \n   - **Total Price:** $3547.80\n\nPlease review the options and let me know if you would like to book one of these hotels or revise your search criteria.",
      "completed": false
    },
    {
      "stage": "revise to restrictive budget",
      "user": "change maximum budget to 500 per night",
      "bot": "Current Portland hotel criteria:\n- Dates: 2027-08-03 to 2027-08-09\n- Nightly budget: no minimum to $500\n- Room type: suite\n- Amenities: freeWiFi, freeParking\n- Distance: no preference\n\nTell me what to revise, or say “search” when ready.",
      "completed": false
    },
    {
      "stage": "empty hotel search",
      "user": "search",
      "bot": "No hotels matched all current criteria. Tell me whether to revise budget, room type, amenities, or distance.",
      "completed": false
    },
    {
      "stage": "restore viable budget",
      "user": "change maximum budget to 750 per night",
      "bot": "Current Portland hotel criteria:\n- Dates: 2027-08-03 to 2027-08-09\n- Nightly budget: no minimum to $750\n- Room type: suite\n- Amenities: freeWiFi, freeParking\n- Distance: no preference\n\nTell me what to revise, or say “search” when ready.",
      "completed": false
    },
    {
      "stage": "second grounded hotel search",
      "user": "search",
      "bot": "Here are the matching Portland hotels:\n1. Hampton Inn & Suites Portland Tigard — 11799 SW 69th Ave, Tigard, OR 97223 — nightly $522.00–$600.30 — total $3,810.60\n2. Hilton Garden Inn Portland Airport — 12048 NE Airport Way, Portland, OR 97220 — nightly $576.00–$662.40 — total $4,204.80\n3. Hilton Garden Inn Beaverton — 15520 NW Gateway Ct, Beaverton, OR 97006 — nightly $459.00–$527.85 — total $3,350.70\n4. Hampton Inn Sherwood Portland — 22000 SW Meinecke Parkway Sherwood, Oregon 97140 USA — nightly $486.00–$558.90 — total $3,547.80\n\nReply with a hotel name or number to book, or tell me which search criterion to revise.",
      "completed": false
    },
    {
      "stage": "validated hotel booking",
      "user": "book hotel 1",
      "bot": "Hampton Inn & Suites Portland Tigard is booked with confirmation #785427. Thank you for choosing Hilton.",
      "completed": true
    }
  ]
};

