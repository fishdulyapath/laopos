import api from './api'

export async function fetchCartItems(cart_key) {
  const { data } = await api.get('/getcartitemlist', {
    params: { cust_code: cart_key, page_size: 500 },
  })
  return data.data || []
}

export async function addItemToCart(itemsArray) {
  const { data } = await api.post('/additemtocart', itemsArray)
  return data
}

export async function deleteCartItem(guid_code, cart_key) {
  const { data } = await api.get('/deleteItem', {
    params: { guid_code, cust_code: cart_key },
  })
  return data
}

export async function deleteAllCartItems(cart_key) {
  const { data } = await api.get('/deleteAllItems', {
    params: { cust_code: cart_key },
  })
  return data
}
