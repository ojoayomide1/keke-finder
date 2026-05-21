Firestore wallet rules notes

Instance:
- Project: keke-finder-cd5fe
- Database: (default)
- Edition: STANDARD
- Location: africa-south1

Collections touched by wallet/payment work:
- users/{uid}: private profile plus wallet/debt for students and earnings for riders.
- rides/{rideId}: rider-owned live ride documents with stopQueue and passengers maps.
- rideRequests/{requestId}: student ride requests and matched/queued status.
- waitingQueue/{queueId}: queued student ride requests.
- scheduledRides/{scheduleId}: student scheduled ride requests.
- adminWallet/main: admin commission balance.
- walletTransactions/{transactionId}: audit ledger for topups, fare deductions, rider earnings, commissions, withdrawals, refunds.
- topUpRequests/{requestId}: Paystack webhook top-up audit entries.
- withdrawalRequests/{requestId}: rider payout requests and admin decisions.

Wallet queries added:
- users/{uid} get/onSnapshot for current wallet or earnings.
- walletTransactions where userId == current uid orderBy createdAt desc limit 10.
- walletTransactions where userId == current uid and type in ["earning", "withdrawal"] orderBy createdAt desc limit 10.
- admin walletTransactions orderBy createdAt desc limit 50, optionally where type == selected type.
- withdrawalRequests where status == "pending" orderBy requestedAt.
- rides where status == "active".
- rides where createdAt >= startOfToday.
- adminWallet/main onSnapshot.

Rules tradeoff:
- This app is currently client-only for ride completion, so the fare split transaction must be allowed from the rider client. The resulting prototype rules scope the affected fields, validate money maps, and keep admin decisions admin-only, but a backend-owned fare settlement endpoint would be stronger before large-scale launch.
