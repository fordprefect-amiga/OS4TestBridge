double helper_compute_root(double input);

int main(void)
{
    double value = helper_compute_root(9.0);
    return (value > 2.99 && value < 3.01) ? 0 : 5;
}
