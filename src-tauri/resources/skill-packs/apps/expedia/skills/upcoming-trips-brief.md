---
id: upcoming-trips-brief
runner: llm
trigger: on-demand
outputs:
  - { path: data/expedia-upcoming-brief-${date}.md, kind: markdown }
---
# Upcoming trips brief

Lay out the next journey end to end so every leg is clear before you leave.

1. **Read what's booked.** From the latest data/expedia-itineraries-*.json, pull trips with any flight, hotel, or activity dated in the future.
2. **Sequence the legs.** For the soonest trip, lay out flights, lodging, and ground transport in time order with confirmation numbers.
3. **Check the connections.** Flag tight layovers, a hotel check-in before the flight lands, or a return flight before hotel checkout.
4. **Flag what's near.** Call out any trip within 14 days and note check-in windows and anything still unbooked between legs.

Output: a leg-by-leg brief of the next trip with confirmations, connection risks, and near-term flags.
