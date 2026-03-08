-- Create coupons table
CREATE TABLE IF NOT EXISTS coupons (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    discount_percentage NUMERIC(5,2) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add coupon_code to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50);

-- Insert the initial coupon
INSERT INTO coupons (code, discount_percentage, is_active)
VALUES ('IBX26', 50.00, true)
ON CONFLICT (code) DO NOTHING;
