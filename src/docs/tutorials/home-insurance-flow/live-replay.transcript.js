const turns = [
  {
    stage: "Qualification",
    user: "Hi, I would like a home insurance quote.",
    bot: "Certainly! I'd be happy to assist with that. This is a preliminary, non-binding home insurance estimate. Could you please provide the property's two-letter state and five-digit ZIP code?",
  },
  {
    stage: "Qualification",
    user: "The property is in Oregon, ZIP 97205.",
    bot: "Thank you! Next, could you please let me know the purchase status of the property (\`own\`, \`buying\`, or \`refinancing\`), how you plan to occupy it (\`primary\`, \`secondary\`, or \`rental\`), and the desired effective date for the insurance? The effective date should be in the format \`YYYY-MM-DD\`, be after today's date, and no more than one year from today.",
  },
  {
    stage: "Qualification → Property",
    user: "I am buying it as my primary residence and want coverage to start October 1, 2027.",
    bot: "Let's start with the property details. Could you please tell me the dwelling type (\`single_family\`, \`townhome\`, or \`duplex\`) and the year it was built?",
  },
  {
    stage: "Property",
    user: "It is a single-family home built in 1998.",
    bot: "Thank you! Next, could you provide the finished square feet, the number of stories, and the construction type (\`wood_frame\`, \`masonry\`, or \`mixed\`) for the home?",
  },
  {
    stage: "Property",
    user: "It has 2,100 finished square feet, two stories, and wood-frame construction.",
    bot: "Great! What is the roof material (\`composition\`, \`metal\`, or \`tile\`) and how many years ago was the roof installed or last replaced?",
  },
  {
    stage: "Property",
    user: "The composition roof is 6 years old.",
    bot: "Thank you. Could you let me know the year the plumbing, electrical, and HVAC systems were last updated? If any system hasn't been updated or you're not sure, please let me know.",
  },
  {
    stage: "Property → Risk",
    user: "Plumbing and electrical were updated in 2018, and HVAC in 2022.",
    bot: "Let's start with any home insurance claims. Have you had any home insurance claims in the last five years? If so, please provide the year, type of claim (e.g., water, fire, wind, theft, liability, or other), and the approximate amount paid for each. If there are no claims, please let me know.",
  },
  {
    stage: "Risk",
    user: "There was one water claim in 2024 for about $7,000.",
    bot: "Thank you. Now, could you tell me if the property has any of the following: a pool, trampoline, or wood stove?",
  },
  {
    stage: "Risk",
    user: "No pool, no trampoline, and no wood stove.",
    bot: "Does the property have any of these protective features: smoke alarms, a burglar alarm, professional alarm monitoring, or an automatic sprinkler system?",
  },
  {
    stage: "Risk → Coverage",
    user: "We have smoke alarms and a burglar alarm with professional monitoring, but no sprinkler system.",
    bot: "To start the coverage preference process, could you please provide the estimated cost to rebuild your home? This amount should be between $100,000 and $2,000,000.",
  },
  {
    stage: "Coverage",
    user: "About $450,000 to rebuild.",
    bot: "Great, we've noted the estimated rebuilding cost of $450,000. Next, please select a deductible amount. You can choose from $1,000, $2,500, or $5,000.",
  },
  {
    stage: "Coverage",
    user: "Use a $2,500 deductible.",
    bot: "Thank you! We've noted a $2,500 deductible. Now, please choose a personal liability limit from the following options: $100,000, $300,000, $500,000, or $1,000,000.",
  },
  {
    stage: "Coverage",
    user: "I want $500,000 of liability coverage.",
    bot: "You've selected a personal liability limit of $500,000. Lastly, are there any optional endorsements you would like to add? The options are water backup, identity theft, or equipment breakdown. You can choose any or none.",
  },
  {
    stage: "Coverage → Review",
    user: "Add water backup coverage only.",
    bot: `Here's a summary of your application for home insurance:

**Qualification:**
- State: OR
- ZIP Code: 97205
- Purchase Status: Buying
- Occupancy: Primary
- Effective Date: 2027-10-01

**Property:**
- Dwelling Type: Single Family
- Year Built: 1998
- Square Feet: 2100
- Stories: 2
- Construction: Wood Frame
- Roof Material: Composition
- Roof Age: 6 years
- Plumbing Updated Year: 2018
- Electrical Updated Year: 2018
- HVAC Updated Year: 2022

**Risk:**
- Claims: 1 (Water damage in 2024 for $7000)
- Hazards: No pool, trampoline, or wood stove
- Protections: Smoke alarms, burglar alarm, and monitored alarm present; No sprinkler system

**Coverage:**
- Dwelling Coverage: $450,000
- Deductible: $2,500
- Liability Limit: $500,000
- Endorsements: Water backup

Please note that this is a preliminary, non-binding estimate. 

Would you like to confirm this application and generate the quote, or is there any correction needed? If there is a correction, please specify.`,
  },
  {
    stage: "Property correction → Review",
    user: "Correction: the roof is actually 4 years old, not 6.",
    bot: `Here is a preliminary, non-binding estimate summary of your home insurance application with Evergreen Home Insurance:

### Qualification
- **State:** OR
- **ZIP Code:** 97205
- **Purchase Status:** Buying
- **Occupancy:** Primary
- **Effective Date:** 2027-10-01

### Property
- **Dwelling Type:** Single Family Home
- **Year Built:** 1998
- **Square Feet:** 2100
- **Stories:** 2
- **Construction Material:** Wood Frame
- **Roof Material:** Composition
- **Roof Age:** 4 years
- **Plumbing Updated Year:** 2018
- **Electrical Updated Year:** 2018
- **HVAC Updated Year:** 2022

### Risk
- **Claims History:** One claim in 2024 for water damage, amounting to $7,000
- **Hazards:** No pool, trampoline, or wood stove
- **Protections:** Smoke alarms, burglar alarm, and monitored alarm present; no sprinkler system

### Coverage
- **Dwelling Coverage Amount:** $450,000
- **Deductible:** $2,500
- **Liability Limit:** $500,000
- **Endorsements:** Water backup coverage

Please review the details above. If everything looks correct, confirm to proceed and generate your quote. Alternatively, indicate any corrections needed. If you wish to stop the process, let me know.`,
  },
  {
    stage: "Review → deterministic rating → Quote",
    user: "Everything is correct. Generate the quote.",
    bot: `### Preliminary home insurance quote EHI-20270715-82009836

| Option | Annual premium | Monthly estimate | Dwelling | Extension | Deductible | Liability | Endorsements |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Essential (ESSENTIAL) | $1,556.12 | $129.68 | $450,000.00 | 0% | $2,500.00 | $500,000.00 | water_backup |
| Enhanced (ENHANCED) | $1,788.18 | $149.02 | $450,000.00 | 10% | $2,500.00 | $500,000.00 | water_backup, equipment_breakdown |
| Premier (PREMIER) | $2,008.24 | $167.35 | $450,000.00 | 25% | $2,500.00 | $1,000,000.00 | water_backup, identity_theft, equipment_breakdown |

Valid through 2027-08-14 under demo rules 2027.1-demo. This is a non-binding estimate, not proof of insurance or an offer to bind coverage.
You can compare options, change the deductible, or select an option for an agent follow-up.`,
  },
  {
    stage: "Quote comparison",
    user: "Compare Essential and Enhanced.",
    bot: `### Quote comparison

| Option | Annual premium | Monthly estimate | Deductible | Liability | Extension | Endorsements |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Essential (ESSENTIAL) | $1,556.12 | $129.68 | $2,500.00 | $500,000.00 | 0% | water_backup |
| Enhanced (ENHANCED) | $1,788.18 | $149.02 | $2,500.00 | $500,000.00 | 10% | water_backup, equipment_breakdown |

Would you like to select one, compare different options, or change the deductible?`,
  },
  {
    stage: "Quote re-rate",
    user: "Re-run the quote with a $5,000 deductible.",
    bot: `### Preliminary home insurance quote EHI-20270715-F769EF8F

| Option | Annual premium | Monthly estimate | Dwelling | Extension | Deductible | Liability | Endorsements |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Essential (ESSENTIAL) | $1,405.31 | $117.11 | $450,000.00 | 0% | $5,000.00 | $500,000.00 | water_backup |
| Enhanced (ENHANCED) | $1,617.76 | $134.81 | $450,000.00 | 10% | $5,000.00 | $500,000.00 | water_backup, equipment_breakdown |
| Premier (PREMIER) | $1,818.21 | $151.52 | $450,000.00 | 25% | $5,000.00 | $1,000,000.00 | water_backup, identity_theft, equipment_breakdown |

Valid through 2027-08-14 under demo rules 2027.1-demo. This is a non-binding estimate, not proof of insurance or an offer to bind coverage.
You can compare options, change the deductible, or select an option for an agent follow-up.`,
  },
  {
    stage: "Quote selection → Consent",
    user: "Select the Enhanced option.",
    bot: `Thank you for choosing the "Enhanced" option. Please note that this quote is a preliminary, non-binding estimate. It's not a guarantee of coverage, a policy issue, or acceptance of payment.

Would you like to consent to a follow-up from one of our agents for further assistance? If you agree, I can collect your name and email, with phone and property street address as optional details.`,
  },
  {
    stage: "Consent → completed",
    user: "Yes, an agent may contact me. I am Jamie Rivera and my email is jamie.rivera@example.com. No phone or street address for now.",
    bot: "I can confirm that a follow-up with an agent was requested for Jamie Rivera at jamie.rivera@example.com. Here is the quote you received: EHI-20270715-F769EF8F, with the Enhanced (ENHANCED) plan. This quote is valid through 2027-08-14. Please remember that no coverage has been bound, and no payment has been taken at this time. If you have any further questions, feel free to ask.",
    completed: true,
  },
];

export default { turns };
