import { TradingRecommendation } from './groq-client';

interface PendingOrder {
  id: string;
  recommendation: TradingRecommendation;
  targetEntry: number;
  currentPrice: number;
  createdAt: Date;
  expiresAt: Date;
}

class LimitOrderManager {
  private pendingOrders: Map<string, PendingOrder> = new Map();
  private readonly EXPIRY_MINUTES = 15;

  /**
   * Add a limit order that will wait for price to reach target entry
   */
  addPendingOrder(recommendation: TradingRecommendation, currentPrice: number): string {
    const targetEntry = recommendation.entryPrice;
    const deviation = Math.abs(targetEntry - currentPrice) / currentPrice * 100;

    console.log(`\n📋 ===== LIMIT ORDER CREATED =====`);
    console.log(`Symbol: ${recommendation.recommendedAsset}`);
    console.log(`Direction: ${recommendation.direction.toUpperCase()}`);
    console.log(`Current Price: $${currentPrice.toFixed(2)}`);
    console.log(`Target Entry: $${targetEntry.toFixed(2)} (${deviation.toFixed(2)}% ${recommendation.direction === 'long' ? 'below' : 'above'} current)`);
    console.log(`Stop Loss: $${recommendation.stopLoss.toFixed(2)}`);
    console.log(`Take Profit: $${recommendation.takeProfit.toFixed(2)}`);
    console.log(`Confidence: ${recommendation.confidence}%`);
    console.log(`Expires: ${this.EXPIRY_MINUTES} minutes`);
    console.log(`Reason: ${recommendation.reasonForStrategy}`);
    console.log(`================================\n`);

    const orderId = `limit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const order: PendingOrder = {
      id: orderId,
      recommendation,
      targetEntry,
      currentPrice,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.EXPIRY_MINUTES * 60 * 1000),
    };

    this.pendingOrders.set(orderId, order);
    
    console.log(`✅ Limit order registered with ID: ${orderId}`);
    console.log(`⏰ Will expire at: ${order.expiresAt.toLocaleTimeString()}`);
    
    return orderId;
  }

  /**
   * Check if current price has reached any pending limit order targets
   */
  checkPendingOrders(currentPrice: number): TradingRecommendation | null {
    if (this.pendingOrders.size === 0) {
      return null;
    }

    console.log(`\n🔍 Checking ${this.pendingOrders.size} pending limit order(s)...`);
    console.log(`Current market price: $${currentPrice.toFixed(2)}`);

    const now = new Date();

    for (const [orderId, order] of this.pendingOrders.entries()) {
      // Remove expired orders
      if (now > order.expiresAt) {
        const age = Math.floor((now.getTime() - order.createdAt.getTime()) / 1000 / 60);
        console.log(`\n⏰ ===== LIMIT ORDER EXPIRED =====`);
        console.log(`Order ID: ${orderId}`);
        console.log(`Direction: ${order.recommendation.direction.toUpperCase()}`);
        console.log(`Target Entry: $${order.targetEntry.toFixed(2)}`);
        console.log(`Current Price: $${currentPrice.toFixed(2)}`);
        console.log(`Age: ${age} minutes (max: ${this.EXPIRY_MINUTES})`);
        console.log(`Status: Price never reached target entry`);
        console.log(`================================\n`);
        
        this.pendingOrders.delete(orderId);
        continue;
      }

      const targetEntry = order.targetEntry;
      const direction = order.recommendation.direction;
      const deviation = Math.abs(currentPrice - targetEntry) / targetEntry * 100;

      // Check if price reached target with 0.1% tolerance
      let triggered = false;
      const tolerance = 0.001; // 0.1%

      if (direction === 'long') {
        // LONG: Trigger when price drops to or below target
        // Current should be <= target entry
        triggered = currentPrice <= targetEntry * (1 + tolerance);
        console.log(`   📍 LONG Order ${orderId}: Target $${targetEntry.toFixed(2)} | Current $${currentPrice.toFixed(2)} | ${triggered ? '✅ TRIGGERED' : '⏳ Waiting'}`);
      } else if (direction === 'short') {
        // SHORT: Trigger when price rises to or above target
        // Current should be >= target entry
        triggered = currentPrice >= targetEntry * (1 - tolerance);
        console.log(`   📍 SHORT Order ${orderId}: Target $${targetEntry.toFixed(2)} | Current $${currentPrice.toFixed(2)} | ${triggered ? '✅ TRIGGERED' : '⏳ Waiting'}`);
      }

      if (triggered) {
        console.log(`\n🎯 ===== LIMIT ORDER TRIGGERED =====`);
        console.log(`Order ID: ${orderId}`);
        console.log(`Direction: ${direction.toUpperCase()}`);
        console.log(`Target Entry: $${targetEntry.toFixed(2)}`);
        console.log(`Trigger Price: $${currentPrice.toFixed(2)}`);
        console.log(`Deviation: ${deviation.toFixed(3)}%`);
        console.log(`Stop Loss: $${order.recommendation.stopLoss.toFixed(2)}`);
        console.log(`Take Profit: $${order.recommendation.takeProfit.toFixed(2)}`);
        console.log(`Age: ${Math.floor((now.getTime() - order.createdAt.getTime()) / 1000 / 60)} minutes`);
        console.log(`Executing ${direction.toUpperCase()} trade NOW...`);
        console.log(`================================\n`);

        // Return recommendation with current price as entry
        // (actual fill will happen at current market price)
        const filledOrder: TradingRecommendation = {
          ...order.recommendation,
          entryPrice: currentPrice, // Use actual trigger price
          executionStrategy: 'market', // Convert to market order for execution
          reasonForStrategy: `Limit order triggered at $${currentPrice.toFixed(2)} (target was $${targetEntry.toFixed(2)})`,
        };

        this.pendingOrders.delete(orderId);
        return filledOrder;
      }
    }

    return null;
  }

  /**
   * Get count of pending orders
   */
  getPendingOrderCount(): number {
    return this.pendingOrders.size;
  }

  /**
   * Get all pending orders info
   */
  getPendingOrders(): PendingOrder[] {
    return Array.from(this.pendingOrders.values());
  }

  /**
   * Clear all pending orders
   */
  clearAllOrders(): void {
    console.log(`🗑️ Clearing ${this.pendingOrders.size} pending limit order(s)`);
    this.pendingOrders.clear();
  }

  /**
   * Clear expired orders (called periodically)
   */
  clearExpiredOrders(): void {
    const now = new Date();
    let expiredCount = 0;

    for (const [orderId, order] of this.pendingOrders.entries()) {
      if (now > order.expiresAt) {
        this.pendingOrders.delete(orderId);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      console.log(`🗑️ Cleared ${expiredCount} expired limit order(s)`);
    }
  }

  /**
   * Cancel a specific order
   */
  cancelOrder(orderId: string): boolean {
    if (this.pendingOrders.has(orderId)) {
      console.log(`❌ Cancelled limit order: ${orderId}`);
      this.pendingOrders.delete(orderId);
      return true;
    }
    return false;
  }
}

// Export singleton instance
export const limitOrderManager = new LimitOrderManager();