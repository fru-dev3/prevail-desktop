---
id: sync-itineraries
runner: llm
trigger: refresh
outputs:
  - { path: data/expedia-itineraries-${date}.json, kind: replace }
---
# Sync itineraries from Expedia

Keep the flights, hotels, and itineraries you book in the vault so every leg of the journey is in one place when plans change.

1. **Pull itineraries.** Fetch upcoming and past trips with their full itinerary and confirmation numbers.
2. **Capture flights.** For each flight, keep airline, flight number, origin and destination, departure and arrival times, and cabin.
3. **Capture lodging and extras.** Keep hotels with dates and city, plus car rentals or activities, each with price and currency.
4. **Write the file.** Save as one normalized JSON document, read-only, never book, change, or cancel any itinerary.

Output: data/expedia-itineraries-${date}.json with flights, hotels, and extras across upcoming and past trips.
