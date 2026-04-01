from models import Customer

a = Customer(customer_id="123", name="Alice")
a.log_message(platform="whatsapp", text="Hi, I need help with my order.")

print(a)