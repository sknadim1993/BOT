import { Resend } from 'resend';

let resendClient: Resend | null = null;

function getResendClient() {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    
    if (!apiKey) {
      throw new Error('RESEND_API_KEY environment variable is not set');
    }
    
    resendClient = new Resend(apiKey);
  }
  
  return resendClient;
}

const FROM_EMAIL = 'noreply@smnahmed.info';
const TO_EMAIL = 'contact@smnahmed.info';

interface TradeNotification {
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
  quantity: string;
  leverage: number;
}

interface TradeClosedNotification extends TradeNotification {
  exitPrice: string;
  pnl: string;
  status: string;
}

export async function sendTradeExecutedEmail(trade: TradeNotification) {
  try {
    const client = getResendClient();
    
    await client.emails.send({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      subject: `🚀 Trade Executed: ${trade.direction.toUpperCase()} ${trade.symbol}`,
      html: `
        <h2>Trade Executed</h2>
        <p><strong>Symbol:</strong> ${trade.symbol}</p>
        <p><strong>Direction:</strong> ${trade.direction.toUpperCase()}</p>
        <p><strong>Entry Price:</strong> $${trade.entryPrice}</p>
        <p><strong>Stop Loss:</strong> $${trade.stopLoss}</p>
        <p><strong>Take Profit:</strong> $${trade.takeProfit}</p>
        <p><strong>Quantity:</strong> ${trade.quantity}</p>
        <p><strong>Leverage:</strong> ${trade.leverage}x</p>
        <p style="margin-top: 20px; color: #666;">Your autonomous trading bot has entered a new position.</p>
      `,
    });

    console.log('✅ Trade executed email sent');
  } catch (error) {
    console.error('❌ Failed to send trade executed email:', error);
  }
}

export async function sendTradeClosedEmail(trade: TradeClosedNotification) {
  try {
    const client = getResendClient();
    const pnl = parseFloat(trade.pnl);
    const isProfit = pnl >= 0;
    
    await client.emails.send({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      subject: `${isProfit ? '✅' : '❌'} Trade Closed: ${trade.symbol} - ${isProfit ? 'Profit' : 'Loss'} $${Math.abs(pnl).toFixed(2)}`,
      html: `
        <h2>Trade Closed</h2>
        <p><strong>Symbol:</strong> ${trade.symbol}</p>
        <p><strong>Direction:</strong> ${trade.direction.toUpperCase()}</p>
        <p><strong>Entry Price:</strong> $${trade.entryPrice}</p>
        <p><strong>Exit Price:</strong> $${trade.exitPrice}</p>
        <p><strong>PnL:</strong> <span style="color: ${isProfit ? 'green' : 'red'}; font-weight: bold;">${isProfit ? '+' : ''}$${pnl.toFixed(2)}</span></p>
        <p><strong>Status:</strong> ${trade.status}</p>
        <p style="margin-top: 20px; color: #666;">Your trade has been closed automatically.</p>
      `,
    });

    console.log('✅ Trade closed email sent');
  } catch (error) {
    console.error('❌ Failed to send trade closed email:', error);
  }
}

interface DailyReport {
  date: string;
  totalPnl: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  bestAsset: string;
  worstAsset: string;
  largestWin: number;
  largestLoss: number;
  tradingMode: string;
}

export async function sendDailyReport(report: DailyReport) {
  try {
    const client = getResendClient();
    const isProfit = report.totalPnl >= 0;
    
    await client.emails.send({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      subject: `📊 Daily Trading Report - ${report.date}`,
      html: `
        <h2>Daily Trading Report</h2>
        <p><strong>Date:</strong> ${report.date}</p>
        <hr>
        <h3>Performance Summary</h3>
        <p><strong>Total PnL:</strong> <span style="color: ${isProfit ? 'green' : 'red'}; font-weight: bold;">${isProfit ? '+' : ''}$${report.totalPnl.toFixed(2)}</span></p>
        <p><strong>Total Trades:</strong> ${report.totalTrades}</p>
        <p><strong>Win Rate:</strong> ${report.winRate.toFixed(1)}% (${report.winningTrades}W / ${report.losingTrades}L)</p>
        <hr>
        <h3>Best & Worst</h3>
        <p><strong>Best Asset:</strong> ${report.bestAsset || 'N/A'}</p>
        <p><strong>Worst Asset:</strong> ${report.worstAsset || 'N/A'}</p>
        <p><strong>Largest Win:</strong> +$${report.largestWin.toFixed(2)}</p>
        <p><strong>Largest Loss:</strong> $${report.largestLoss.toFixed(2)}</p>
        <hr>
        <p><strong>Trading Mode:</strong> ${report.tradingMode.toUpperCase()}</p>
        <p style="margin-top: 20px; color: #666; font-size: 12px;">This is your automated daily trading summary from your crypto trading bot.</p>
      `,
    });

    console.log('✅ Daily report email sent');
  } catch (error) {
    console.error('❌ Failed to send daily report email:', error);
  }
}