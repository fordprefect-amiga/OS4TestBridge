int add_values(int a, int b);
int expected_value(void);

int main(void)
{
    return add_values(20, 22) == expected_value() ? 0 : 5;
}
