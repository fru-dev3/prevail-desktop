---
id: spend-and-habits-review
runner: llm
trigger: on-demand
outputs:
  - { path: data/ubereats-spend-habits-${date}.md, kind: markdown }
---
# Spend and habits review

See what the takeout habit actually costs once fees and tips are counted in.

1. **Total the spend.** From the latest data/ubereats-orders-*.json, sum order totals over the last 90 days and show the monthly burn.
2. **Show the markup.** Break out what went to food versus delivery fees, service fees, and tips, as a share of the total.
3. **Count the frequency.** Show orders per week and average order size, and flag the weeks that ran hot.
4. **Name the swap.** Point to where cooking, pickup, or a pass would have saved real money, with the rough dollar figure.

Output: a takeout spend review with the monthly total, the fee-and-tip share, ordering frequency, and one concrete swap.
