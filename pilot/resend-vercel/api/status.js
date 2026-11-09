/**
 * Isolated Resend pilot health: metadata only, no internal details or mail.
 * This is NOT a claim that the family agent or webhook is running.
 */
export function GET() {
  return Response.json({
    service: 'nexlupa-resend-isolated-pilot',
    phase: 'locked',
    webhookIngestion: false,
    durableQueue: false,
    familyAgent: false,
    calendarWrites: false
  }, {status: 200, headers: {
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'
  }});
}
