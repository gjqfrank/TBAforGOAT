-- Allow authenticated users to read their own account request by email
CREATE POLICY "self_select_account_requests"
    ON public.account_requests
    FOR SELECT
    TO authenticated
    USING (email = auth.email());
