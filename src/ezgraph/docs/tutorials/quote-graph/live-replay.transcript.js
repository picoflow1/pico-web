export default {
  "turns": [
    {
      "stage": "driver stage greeting",
      "user": "Hi, I'd like a quote for my car insurance.",
      "bot": "Absolutely — I can help with that.\n\nWhat’s your full name?",
      "completed": false
    },
    {
      "stage": "name and birth date",
      "user": "Jamie Rivera, born April 12, 1993.",
      "bot": "Thanks, Jamie. What state is your driver’s license issued in, and is it valid or a learner’s permit?",
      "completed": false
    },
    {
      "stage": "driver capture advances to vehicle",
      "user": "Licensed in Oregon, valid license, for about 10 years.",
      "bot": "Thanks — I’ve saved Jamie Rivera, born 1993-04-12, with a valid Oregon license and 10 years licensed.\n\nWhat’s the vehicle’s year, make, and model?",
      "completed": false
    },
    {
      "stage": "trim disambiguation",
      "user": "It's a 2019 Toyota Camry.",
      "bot": "I found a few 2019 Toyota Camry trims. Which one is yours: LE, SE, or XSE?",
      "completed": false
    },
    {
      "stage": "resolved vehicle asks usage",
      "user": "The SE trim.",
      "bot": "Got it — 2019 Toyota Camry SE.\n\nDo you own it, finance it, or lease it? And about how many miles do you drive per year?",
      "completed": false
    },
    {
      "stage": "ownership and mileage",
      "user": "I finance it and drive about 12,000 miles a year.",
      "bot": "Thanks. Where is it usually parked overnight: garage, driveway, or street?",
      "completed": false
    },
    {
      "stage": "vehicle capture advances to history",
      "user": "In my driveway.",
      "bot": "Sure — I just need two things:\n\n1. Do you currently have auto insurance?\n2. In the past 12 months, did your coverage lapse at any point?\n\nAlso, please list any incidents in the last 5 years with the month as YYYY-MM, or say “none.” Categories are:\n- at-fault accident\n- not-at-fault accident\n- violation (like a speeding ticket)\n- comprehensive claim (theft, glass, weather, animal damage)",
      "completed": false
    },
    {
      "stage": "insurance status",
      "user": "I'm insured today and had no lapse in the past year.",
      "bot": "Thanks. Any incidents in the last 5 years? Please list the month as YYYY-MM for any:\n- at-fault accident\n- not-at-fault accident\n- violation\n- comprehensive claim\n\n“None” is perfectly fine.",
      "completed": false
    },
    {
      "stage": "history capture advances to coverage",
      "user": "Just one speeding ticket in March 2026, nothing else.",
      "bot": "Since the Camry is financed, it needs both collision and comprehensive coverage.\n\nWhich liability level would you like: state minimum, standard, or premium? And would you like $250, $500, or $1,000 deductibles for collision and comprehensive?",
      "completed": false
    },
    {
      "stage": "liability selection",
      "user": "Standard liability, please.",
      "bot": "You got it. Since it’s financed, I still need deductibles for both collision and comprehensive.\n\nWould you like $250, $500, or $1,000 for each?",
      "completed": false
    },
    {
      "stage": "lender rule blocks liability-only",
      "user": "Can I skip collision and comprehensive entirely?",
      "bot": "Because the car is financed, collision and comprehensive are required, so you can’t skip them entirely.\n\nWhich deductibles would you like for collision and comprehensive: $250, $500, or $1,000 each?",
      "completed": false
    },
    {
      "stage": "deductibles and extras",
      "user": "Fine, $500 deductibles for both, and add rental reimbursement but no roadside.",
      "bot": "Got it. What date would you like the policy to start? It can start today through 60 days from today.",
      "completed": false
    },
    {
      "stage": "coverage capture presents quote tiers",
      "user": "Start it on June 15.",
      "bot": "Here are your quote options, starting on **June 15, 2027**:\n\n1. **Saver** — **$99.96/month**  \n   - Liability: **State-minimum**  \n   - Deductibles: **$1,000 collision / $1,000 comprehensive**  \n   - Extras: **None**\n\n2. **Selected** — **$140.43/month**  \n   - Liability: **Standard**  \n   - Deductibles: **$500 collision / $500 comprehensive**  \n   - Extras: **Rental**  \n   - **Recommended** based on your choices\n\n3. **Shield** — **$182.17/month**  \n   - Liability: **Premium**  \n   - Deductibles: **$250 collision / $250 comprehensive**  \n   - Extras: **Rental and roadside**\n\nYou can:\n- **Pick a tier** — for example, “I’ll take Selected”\n- **Adjust the quote** — for example, “What if my deductible were $1,000?”\n- **Start over on coverage** — and we can rework the choices from scratch",
      "completed": false
    },
    {
      "stage": "deductible what-if adjustment",
      "user": "What would it cost if both deductibles were $1000?",
      "bot": "Here is the updated quote:\n1. Saver — state-minimum liability, $1000/$1000 deductibles, no extras: $99.96/mo\n2. Your selection — standard liability, $1000/$1000 deductibles, rental: $130.49/mo\n3. Shield — premium liability, $250/$250 deductibles, rental + roadside: $182.17/mo\nAdjust anything else, accept a tier, or rework the coverage.",
      "completed": false
    },
    {
      "stage": "acceptance completes the quote",
      "user": "Accept my selected option, please.",
      "bot": "You're all set — your selected coverage (Your selection) is locked in at $130.49/month starting 2027-06-15. Your quote reference is QT-648463.",
      "completed": true
    }
  ]
};

