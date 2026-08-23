const turns = [
  { stage: "Weather", user: "Hi", bot: "Only LA and NYC are supported. Which supported cities would you like to compare?" },
  { stage: "Weather", user: "PDX,PHX", bot: "PDX and PHX are unsupported. Only LA and NYC are supported; please enter LA or NYC." },
  { stage: "Weather → FooLogic → GooLogic → Favorites", user: "LA,NYC", bot: "What are your favorite color (red, blue, or white), movie, and season (spring, summer, autumn, or winter)?" },
  { stage: "Favorites → Name", user: "blue, Star Wars, summer", bot: "Please provide your full name." },
  { stage: "Name", user: "John Doe", bot: "John Doe cannot be accepted. Please provide a different full name." },
  { stage: "Name → nested InContext work → DOB", user: "John Wick", bot: "Please provide your date of birth." },
  { stage: "DOB → Address", user: "1/1/2000", bot: "Please provide your complete US mailing address." },
  { stage: "Address → completed", user: "123 K St. Portland, OR 97006", bot: "Your address was accepted and your profile collection is complete.", completed: true },
];

export default { turns };
