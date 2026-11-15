"use client";
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils';
import React from 'react';
import { useMutation } from '@tanstack/react-query';

const Checkout = () => {
  const [cart, setCart] = useState([]);
  const [customer, setCustomer] = useState('');
  const router = useRouter();

  useEffect(() => {
    // Assume cart is passed via local storage or context
    const savedCart = JSON.parse(localStorage.getItem('cart') || '[]');
    setCart(savedCart);
  }, []);

  // TanStack Mutation for checkout
  const checkoutMutation = useMutation({
    mutationFn: async (orderData) => {
      const response = await fetch('/pos/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData),
      });
      if (!response.ok) {
        throw new Error('Failed to place order');
      }
      return response.json();
    },
    onSuccess: () => {
      localStorage.removeItem('cart');
      toast.success('Order placed successfully');
      router.push('/pos/orders');
    },
    onError: () => {
      toast.error('Failed to place order');
    },
  });

  const handleCheckout = async () => {
    if (!customer.trim()) {
      toast.error('Please enter customer name');
      return;
    }

    const orderData = {
      cartItems: cart,
      customer,
      total: cart.reduce((sum, item) => sum + item.quantity * item.price, 0),
    };

    checkoutMutation.mutate(orderData);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 max-w-md mx-auto">
      <h2 className="text-2xl font-bold mb-4">Checkout</h2>
      {cart.length === 0 ? (
        <p>No items in cart</p>
      ) : (
        <div className="space-y-4">
          {cart.map(item => (
            <div key={item.itcd} className="flex justify-between">
              <span>{item.item}</span>
              <span>{item.quantity} x {formatCurrency(item.price)}</span>
            </div>
          ))}
          <p className="font-bold">Total: {formatCurrency(cart.reduce((sum, item) => sum + item.quantity * item.price, 0))}</p>
          <div>
            <Label htmlFor="customer">Customer Name</Label>
            <Input 
              id="customer" 
              value={customer} 
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="Enter customer name"
            />
          </div>
          <Button 
            onClick={handleCheckout}
            disabled={checkoutMutation.isLoading}
            className="w-full"
          >
            {checkoutMutation.isLoading ? 'Processing...' : 'Complete Order'}
          </Button>
        </div>
      )}
    </motion.div>
  );
}
export default Checkout;